import {
  GenerationInProgressError,
  diffDays,
  eachDate,
  isValidDateString,
  listReports,
  listRunHistory,
  loadConfig,
  readReport,
  renderRangeMarkdown,
  renderReportMarkdown,
  runReportGeneration,
  todayInJst,
  type AppConfig,
  type RedmineClient,
  type Report,
  type SuccessReport,
} from "@pmreport/shared";
import express, { type Express, type Request, type Response } from "express";
import * as path from "node:path";
import { requireUser, type AuthedRequest } from "./auth";

export interface CreateAppOptions {
  config?: AppConfig;
  /** テスト用にRedmineクライアントを差し替える */
  client?: RedmineClient;
  now?: () => Date;
}

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

function toListItem(report: Report) {
  if (report.status === "failed") {
    return {
      targetDate: report.targetDate,
      status: report.status,
      generatedAt: report.generatedAt,
      errorMessage: report.errorMessage,
    };
  }
  return {
    targetDate: report.targetDate,
    status: report.status,
    generatedAt: report.generatedAt,
    summary: report.summary,
  };
}

function sendMarkdown(res: Response, filename: string, body: string): void {
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(body);
}

export function createApp(options: CreateAppOptions = {}): Express {
  const config = options.config ?? loadConfig();
  const now = options.now ?? (() => new Date());
  const app = express();
  app.use(express.json());

  const api = express.Router();
  api.use(requireUser);

  api.get("/whoami", (req: Request, res: Response) => {
    res.json({ user: (req as AuthedRequest).user });
  });

  /** 画面ヘッダーの表示や入力チェックに使う、機微情報を含まない設定値 */
  api.get("/app-info", (_req: Request, res: Response) => {
    res.json({
      project: config.project,
      trackers: config.trackers,
      retentionDays: config.retentionDays,
      maxRangeDays: config.export.maxRangeDays,
      today: todayInJst(now()),
    });
  });

  api.get("/run-history", async (_req: Request, res: Response) => {
    res.json({ items: await listRunHistory(config) });
  });

  /**
   * 期間指定エクスポート。`/reports/:date` より先に登録しないと
   * "export" が日付として解釈されてしまうため、定義順に依存する。
   */
  api.get("/reports/export", async (req: Request, res: Response) => {
    const from = String(req.query.from ?? "");
    const to = String(req.query.to ?? "");
    if (!isValidDateString(from) || !isValidDateString(to)) {
      sendError(res, 400, "INVALID_RANGE", "開始日・終了日はYYYY-MM-DD形式で指定してください");
      return;
    }
    const days = diffDays(to, from) + 1;
    if (days <= 0) {
      sendError(res, 400, "INVALID_RANGE", "開始日は終了日以前の日付を指定してください");
      return;
    }
    if (days > config.export.maxRangeDays) {
      sendError(
        res,
        400,
        "INVALID_RANGE",
        `期間は最大${config.export.maxRangeDays}日までです（指定: ${days}日）`
      );
      return;
    }

    const reports: SuccessReport[] = [];
    const missingDates: string[] = [];
    for (const date of eachDate(from, to)) {
      const report = await readReport(config, date);
      if (report && report.status === "success") {
        reports.push(report);
      } else {
        missingDates.push(date);
      }
    }
    if (reports.length === 0) {
      sendError(res, 404, "NO_REPORTS_IN_RANGE", "指定された期間に出力できるレポートがありません");
      return;
    }
    sendMarkdown(
      res,
      `report_${from}_${to}.md`,
      renderRangeMarkdown({ from, to, reports, missingDates })
    );
  });

  api.get("/reports", async (_req: Request, res: Response) => {
    const reports = await listReports(config);
    res.json({ items: reports.map(toListItem) });
  });

  api.get("/reports/:date", async (req: Request, res: Response) => {
    const date = req.params.date;
    const report = isValidDateString(date) ? await readReport(config, date) : undefined;
    if (!report) {
      sendError(res, 404, "REPORT_NOT_FOUND", `${date} のレポートは存在しません`);
      return;
    }
    res.json(report);
  });

  api.get("/reports/:date/export", async (req: Request, res: Response) => {
    const date = req.params.date;
    const report = isValidDateString(date) ? await readReport(config, date) : undefined;
    if (!report) {
      sendError(res, 404, "REPORT_NOT_FOUND", `${date} のレポートは存在しません`);
      return;
    }
    if (report.status === "failed") {
      sendError(res, 409, "REPORT_FAILED", "生成に失敗したレポートはエクスポートできません");
      return;
    }
    sendMarkdown(res, `report_${date}.md`, renderReportMarkdown(report));
  });

  api.post("/reports/:date/regenerate", async (req: Request, res: Response) => {
    const date = req.params.date;
    if (!isValidDateString(date)) {
      sendError(res, 400, "INVALID_DATE", "対象日はYYYY-MM-DD形式で指定してください");
      return;
    }
    if (diffDays(date, todayInJst(now())) > 0) {
      sendError(res, 400, "INVALID_DATE", "未来の日付は指定できません");
      return;
    }
    try {
      const report = await runReportGeneration({
        config,
        targetDate: date,
        trigger: "manual",
        triggeredBy: (req as AuthedRequest).user ?? null,
        client: options.client,
      });
      res.json(report);
    } catch (err) {
      if (err instanceof GenerationInProgressError) {
        sendError(res, 409, "GENERATION_IN_PROGRESS", err.message);
        return;
      }
      throw err;
    }
  });

  app.use("/api", api);
  app.use(express.static(path.join(__dirname, "public")));

  return app;
}
