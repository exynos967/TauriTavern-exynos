import { warn } from '../index.js';
import { getAutomationProfiler, QUICK_REPLY_PERF_IDENTITY, reportAutomationSample } from '../../../tauri/perf/automation-profiler.js';
import { QuickReply } from './QuickReply.js';
import { QuickReplySettings } from './QuickReplySettings.js';

export class AutoExecuteHandler {
    /** @type {QuickReplySettings} */ settings;

    /** @type {Boolean[]}*/ preventAutoExecuteStack = [];


    constructor(/** @type {QuickReplySettings} */settings) {
        this.settings = settings;
    }


    checkExecute() {
        return this.settings.isEnabled && !this.preventAutoExecuteStack.slice(-1)[0];
    }


    async performAutoExecute(/** @type {QuickReply[]} */qrList, trigger) {
        for (const [index, qr] of qrList.entries()) {
            const profiler = getAutomationProfiler();
            const startedAt = profiler ? performance.now() : 0;
            let success = false;
            this.preventAutoExecuteStack.push(qr.preventAutoExecute);
            try {
                await qr.execute({ isAutoExecute: true });
                success = true;
            } catch (ex) {
                warn(ex);
            } finally {
                this.preventAutoExecuteStack.pop();
                if (profiler) {
                    const identity = qr[QUICK_REPLY_PERF_IDENTITY] ?? {};
                    reportAutomationSample(profiler, {
                        kind: 'quick-reply-auto',
                        trigger,
                        index,
                        quickReplyId: Number.isFinite(Number(qr.id)) ? Number(qr.id) : null,
                        setKey: identity.setKey ?? null,
                        sourceKey: identity.sourceKey ?? null,
                        scope: identity.scope ?? null,
                        success,
                        durationMs: performance.now() - startedAt,
                    });
                }
            }
        }
    }


    getCommands(eventName) {
        const getFromConfig = (config) => {
            // This safely handles cases where a link exists but the set hasn't been loaded (link.set is null)
            return config?.setList?.map(link => link.set ? link.set.qrList.filter(qr => qr[eventName]) : [])?.flat() ?? [];
        };
        return [
            ...getFromConfig(this.settings.config),
            ...getFromConfig(this.settings.chatConfig),
            ...getFromConfig(this.settings.charConfig),
        ];
    }

    async handleStartup() {
        if (!this.checkExecute()) return;
        await this.performAutoExecute(this.getCommands('executeOnStartup'), 'executeOnStartup');
    }

    async handleUser() {
        if (!this.checkExecute()) return;
        await this.performAutoExecute(this.getCommands('executeOnUser'), 'executeOnUser');
    }

    async handleAi() {
        if (!this.checkExecute()) return;
        await this.performAutoExecute(this.getCommands('executeOnAi'), 'executeOnAi');
    }

    async handleChatChanged() {
        if (!this.checkExecute()) return;
        await this.performAutoExecute(this.getCommands('executeOnChatChange'), 'executeOnChatChange');
    }

    async handleGroupMemberDraft() {
        if (!this.checkExecute()) return;
        await this.performAutoExecute(this.getCommands('executeOnGroupMemberDraft'), 'executeOnGroupMemberDraft');
    }

    async handleNewChat() {
        if (!this.checkExecute()) return;
        await this.performAutoExecute(this.getCommands('executeOnNewChat'), 'executeOnNewChat');
    }

    async handleBeforeGeneration() {
        if (!this.checkExecute()) return;
        await this.performAutoExecute(this.getCommands('executeBeforeGeneration'), 'executeBeforeGeneration');
    }

    /**
     * @param {any[]} entries Set of activated entries
     */
    async handleWIActivation(entries) {
        if (!this.checkExecute() || !Array.isArray(entries) || entries.length === 0) return;
        const automationIds = entries.map(entry => entry.automationId).filter(Boolean);
        if (automationIds.length === 0) return;

        const getFromConfig = (config) => {
            return config?.setList
                ?.map(link => link.set ? link.set.qrList.filter(qr => qr.automationId && automationIds.includes(qr.automationId)) : [])
                ?.flat() ?? [];
        };

        const qrList = [
            ...getFromConfig(this.settings.config),
            ...getFromConfig(this.settings.chatConfig),
            ...getFromConfig(this.settings.charConfig),
        ];

        await this.performAutoExecute(qrList, 'worldInfoActivation');
    }
}
