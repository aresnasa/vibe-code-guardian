/**
 * Language configuration for commit messages
 * Supports English and Chinese with auto-detection from VS Code locale
 */

import * as vscode from 'vscode';
import { CheckpointType, CheckpointSource, CommitLanguage, NotificationLevel } from './types';

/** Language strings for checkpoint names and commit messages */
export interface LanguageStrings {
    typeEmoji: Record<CheckpointType, string>;
    typeLabel: Record<CheckpointType, string>;
    sourceLabel: Record<CheckpointSource, string>;
    commitPrefix: string;
    sessionStart: string;
    quickSave: string;
    autoSave: string;
    manualCheckpoint: string;
    aiCheckpoint: string;
}

/** English language strings */
const EN_STRINGS: LanguageStrings = {
    typeEmoji: {
        [CheckpointType.Auto]: '🔄',
        [CheckpointType.Manual]: '💾',
        [CheckpointType.AIGenerated]: '🤖',
        [CheckpointType.SessionStart]: '🎮',
        [CheckpointType.AutoSave]: '⏰'
    },
    typeLabel: {
        [CheckpointType.Auto]: 'Auto',
        [CheckpointType.Manual]: 'Manual',
        [CheckpointType.AIGenerated]: 'AI',
        [CheckpointType.SessionStart]: 'Session Start',
        [CheckpointType.AutoSave]: 'AutoSave'
    },
    sourceLabel: {
        [CheckpointSource.User]: 'Manual',
        [CheckpointSource.Copilot]: 'Copilot',
        [CheckpointSource.Claude]: 'Claude',
        [CheckpointSource.Cline]: 'Cline',
        [CheckpointSource.OtherAI]: 'AI',
        [CheckpointSource.AutoSave]: 'AutoSave',
        [CheckpointSource.FileWatcher]: 'Watcher',
        [CheckpointSource.Unknown]: 'Unknown'
    },
    commitPrefix: '[Vibe Guardian]',
    sessionStart: 'Session Start',
    quickSave: 'Quick Save',
    autoSave: 'Auto Save',
    manualCheckpoint: 'Manual Checkpoint',
    aiCheckpoint: 'AI Checkpoint'
};

/** Chinese language strings */
const ZH_STRINGS: LanguageStrings = {
    typeEmoji: {
        [CheckpointType.Auto]: '🔄',
        [CheckpointType.Manual]: '💾',
        [CheckpointType.AIGenerated]: '🤖',
        [CheckpointType.SessionStart]: '🎮',
        [CheckpointType.AutoSave]: '⏰'
    },
    typeLabel: {
        [CheckpointType.Auto]: '自动',
        [CheckpointType.Manual]: '手动',
        [CheckpointType.AIGenerated]: 'AI',
        [CheckpointType.SessionStart]: '会话开始',
        [CheckpointType.AutoSave]: '自动保存'
    },
    sourceLabel: {
        [CheckpointSource.User]: '手动',
        [CheckpointSource.Copilot]: 'Copilot',
        [CheckpointSource.Claude]: 'Claude',
        [CheckpointSource.Cline]: 'Cline',
        [CheckpointSource.OtherAI]: 'AI',
        [CheckpointSource.AutoSave]: '自动保存',
        [CheckpointSource.FileWatcher]: '监视器',
        [CheckpointSource.Unknown]: '未知'
    },
    commitPrefix: '[Vibe Guardian]',
    sessionStart: '会话开始',
    quickSave: '快速保存',
    autoSave: '自动保存',
    manualCheckpoint: '手动存档',
    aiCheckpoint: 'AI 存档'
};

/**
 * Detects VS Code's current display language
 * @returns 'zh' if Chinese, 'en' otherwise
 */
export function detectVSCodeLanguage(): 'en' | 'zh' {
    const locale = vscode.env.language;
    // Check for Chinese locales: zh-CN, zh-TW, zh-HK, etc.
    if (locale.startsWith('zh')) {
        return 'zh';
    }
    return 'en';
}

/**
 * Gets the effective language based on settings
 * @param commitLanguage The configured language setting
 * @returns The resolved language ('en' or 'zh')
 */
export function getEffectiveLanguage(commitLanguage: CommitLanguage): 'en' | 'zh' {
    if (commitLanguage === 'auto') {
        return detectVSCodeLanguage();
    }
    return commitLanguage;
}

/**
 * Gets language strings based on the language setting
 * @param commitLanguage The configured language setting
 * @returns Language strings object
 */
export function getLanguageStrings(commitLanguage: CommitLanguage): LanguageStrings {
    const effectiveLang = getEffectiveLanguage(commitLanguage);
    return effectiveLang === 'zh' ? ZH_STRINGS : EN_STRINGS;
}

/**
 * Generates a checkpoint name using the appropriate language
 * @param type Checkpoint type
 * @param source Checkpoint source
 * @param commitLanguage Language setting
 * @returns Formatted checkpoint name
 */
export function generateLocalizedCheckpointName(
    type: CheckpointType,
    source: CheckpointSource,
    commitLanguage: CommitLanguage
): string {
    const strings = getLanguageStrings(commitLanguage);
    const effectiveLang = getEffectiveLanguage(commitLanguage);
    
    const now = new Date();
    const timestamp = now.toLocaleString(effectiveLang === 'zh' ? 'zh-CN' : 'en-US', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).replace(/\//g, '-');

    return `${strings.typeEmoji[type]} ${strings.sourceLabel[source]} @ ${timestamp}`;
}

/**
 * Gets the display name for the current language setting
 * @param commitLanguage The language setting
 * @returns Display name with icon
 */
export function getLanguageDisplayName(commitLanguage: CommitLanguage): string {
    switch (commitLanguage) {
        case 'zh':
            return '🇨🇳 中文';
        case 'en':
            return '🇺🇸 English';
        case 'auto':
            const detected = detectVSCodeLanguage();
            return detected === 'zh' ? '🔄 自动 (中文)' : '🔄 Auto (English)';
    }
}

/**
 * Gets the next language in the cycle: auto -> en -> zh -> auto
 * @param current Current language setting
 * @returns Next language setting
 */
export function getNextLanguage(current: CommitLanguage): CommitLanguage {
    switch (current) {
        case 'auto':
            return 'en';
        case 'en':
            return 'zh';
        case 'zh':
            return 'auto';
    }
}
