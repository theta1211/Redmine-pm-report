import { parseTargetDateArg, runOnce } from "./runOnce";

/**
 * Windowsタスクスケジューラから平日1日1回起動されるエントリポイント。
 * レポートの生成失敗は想定内の結果として実行履歴に記録するため終了コード0とし、
 * 排他エラーなど想定外の失敗のみ終了コード1で終わる。
 */
async function main(): Promise<void> {
  const targetDate = parseTargetDateArg(process.argv.slice(2));
  const result = await runOnce({ targetDate });
  console.log(`[pm-report-batch] ${JSON.stringify(result)}`);
}

main().catch((err) => {
  console.error("[pm-report-batch] unexpected failure", err);
  process.exit(1);
});
