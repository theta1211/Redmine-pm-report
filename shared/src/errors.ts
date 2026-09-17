/** Redmineへ接続できない・APIがエラーを返した */
export class RedmineUnavailableError extends Error {}

/** 設定値の不足・不整合（対象プロジェクトやトラッカーが見つからない等） */
export class ConfigurationError extends Error {}

/** 同一対象日に対する生成処理が既に実行中 */
export class GenerationInProgressError extends Error {
  constructor(targetDate: string) {
    super(`${targetDate} のレポートは他の処理が実行中のため再生成できません`);
  }
}
