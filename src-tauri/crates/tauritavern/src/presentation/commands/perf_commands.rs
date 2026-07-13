use serde::Serialize;
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfRuntimeSample {
    sampled_at_unix_ms: u128,
    process_cpu_ticks: Option<u64>,
    system_cpu_ticks: Option<u64>,
    clock_ticks_per_second: Option<u64>,
    logical_cpu_count: usize,
    resident_memory_bytes: Option<u64>,
    battery_temperature_c: Option<f64>,
    battery_current_microamps: Option<i64>,
    battery_voltage_microvolts: Option<i64>,
    battery_status: Option<String>,
}

fn read_trimmed(path: &str) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn parse_process_cpu_ticks(stat: &str) -> Option<u64> {
    let fields = stat
        .get(stat.rfind(')')? + 1..)?
        .split_whitespace()
        .collect::<Vec<_>>();
    let user_ticks = fields.get(11)?.parse::<u64>().ok()?;
    let system_ticks = fields.get(12)?.parse::<u64>().ok()?;
    user_ticks.checked_add(system_ticks)
}

fn parse_system_cpu_ticks(stat: &str) -> Option<u64> {
    let cpu_line = stat.lines().find(|line| line.starts_with("cpu "))?;
    cpu_line
        .split_whitespace()
        .skip(1)
        .try_fold(0_u64, |sum, value| {
            sum.checked_add(value.parse::<u64>().ok()?)
        })
}

fn parse_resident_memory_bytes(status: &str) -> Option<u64> {
    let rss_line = status.lines().find(|line| line.starts_with("VmRSS:"))?;
    rss_line
        .split_whitespace()
        .nth(1)?
        .parse::<u64>()
        .ok()?
        .checked_mul(1024)
}

fn read_battery_path(name: &str) -> Option<String> {
    for supply in ["battery", "Battery", "BAT0"] {
        let path = format!("/sys/class/power_supply/{supply}/{name}");
        if let Some(value) = read_trimmed(&path) {
            return Some(value);
        }
    }
    None
}

fn read_battery_number<T: std::str::FromStr>(name: &str) -> Option<T> {
    read_battery_path(name)?.parse().ok()
}

fn normalize_battery_temperature(raw: f64) -> f64 {
    if raw.abs() >= 1_000.0 {
        raw / 1_000.0
    } else {
        raw / 10.0
    }
}

#[cfg(unix)]
fn clock_ticks_per_second() -> Option<u64> {
    // SAFETY: sysconf only reads the process-wide clock tick configuration.
    let ticks = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    u64::try_from(ticks).ok().filter(|value| *value > 0)
}

#[cfg(not(unix))]
fn clock_ticks_per_second() -> Option<u64> {
    None
}

fn sample_runtime() -> PerfRuntimeSample {
    let sampled_at_unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();

    let process_cpu_ticks = read_trimmed("/proc/self/stat")
        .as_deref()
        .and_then(parse_process_cpu_ticks);
    let system_cpu_ticks = read_trimmed("/proc/stat")
        .as_deref()
        .and_then(parse_system_cpu_ticks);
    let resident_memory_bytes = read_trimmed("/proc/self/status")
        .as_deref()
        .and_then(parse_resident_memory_bytes);
    let battery_temperature_c =
        read_battery_number::<f64>("temp").map(normalize_battery_temperature);

    PerfRuntimeSample {
        sampled_at_unix_ms,
        process_cpu_ticks,
        system_cpu_ticks,
        clock_ticks_per_second: clock_ticks_per_second(),
        logical_cpu_count: std::thread::available_parallelism()
            .map(usize::from)
            .unwrap_or(1),
        resident_memory_bytes,
        battery_temperature_c,
        battery_current_microamps: read_battery_number("current_now"),
        battery_voltage_microvolts: read_battery_number("voltage_now"),
        battery_status: read_battery_path("status"),
    }
}

#[tauri::command]
pub fn get_perf_runtime_sample() -> PerfRuntimeSample {
    sample_runtime()
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_battery_temperature, parse_process_cpu_ticks, parse_resident_memory_bytes,
        parse_system_cpu_ticks,
    };

    #[test]
    fn parses_process_cpu_ticks_when_command_contains_spaces() {
        let stat = "42 (Tauri Tavern) S 1 2 3 4 5 6 7 8 9 10 100 25 0 0";
        assert_eq!(parse_process_cpu_ticks(stat), Some(125));
    }

    #[test]
    fn parses_system_cpu_and_resident_memory() {
        assert_eq!(parse_system_cpu_ticks("cpu  1 2 3 4 5\ncpu0 1 2"), Some(15));
        assert_eq!(
            parse_resident_memory_bytes("Name:\ttt\nVmRSS:\t2048 kB\n"),
            Some(2_097_152)
        );
    }

    #[test]
    fn normalizes_common_battery_temperature_units() {
        assert_eq!(normalize_battery_temperature(385.0), 38.5);
        assert_eq!(normalize_battery_temperature(38_500.0), 38.5);
    }
}
