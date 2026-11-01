import * as vscode from 'vscode'
import { m } from '@srmd/l10n'
import { read_settings as read_workspace_settings, type WorkspaceSettings } from '@srmd/workspace'

/** srmd settings, read when the extension loads and again whenever they change. */
export interface Settings extends WorkspaceSettings {
  /**
   * Whether srmd is on in this workspace. Off, nothing is searched, watched or shown, so workspaces
   * without notes, such as code projects, cost nothing beyond the status bar item.
   */
  enabled: boolean
}

/** Read the first workspace folder's srmd settings, logging and replacing values outside their schema. */
export function read_settings(log: vscode.LogOutputChannel): Settings {
  /* Read the configuration section once; the shared settings are validated by the workspace component. */
  const cfg = vscode.workspace.getConfiguration('srmd', vscode.workspace.workspaceFolders?.[0]?.uri ?? null)
  /** Report a value VS Code accepted although the manifest schema rejects it. */
  const invalid = (name: string): void => log.warn(m.vscode_setting_invalid({ name: `srmd.${name}` }))
  const enabled = cfg.get<unknown>('enabled', false)
  if (typeof enabled !== 'boolean') invalid('enabled')
  return { enabled: enabled === true, ...read_workspace_settings(name => cfg.get<unknown>(name), invalid) }
}

/**
 * Turn srmd on or off for the open workspace by writing its workspace setting; the configuration change
 * that follows applies it. A workspace setting overrides the user setting in both directions.
 * @returns false, without writing, when no folder is open: there is nothing to turn on.
 */
export async function write_enabled(enabled: boolean): Promise<boolean> {
  if (!vscode.workspace.workspaceFolders?.length) return false
  await vscode.workspace.getConfiguration('srmd').update('enabled', enabled, vscode.ConfigurationTarget.Workspace)
  return true
}
