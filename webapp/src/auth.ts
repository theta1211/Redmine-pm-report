import type { NextFunction, Request, Response } from "express";

/**
 * Windows統合認証のハンドシェイク自体はIIS側で行う前提。
 * IISの「Windows認証」を有効・匿名認証を無効にしたうえで、URL Rewriteルールにより
 * 認証済みユーザー名（LOGON_USER）をX-Remote-Userヘッダーとしてこのアプリへ転送する。
 * クライアントが自称した同名ヘッダーはIIS側で必ず上書きされる（webapp/web.config参照）。
 *
 * 非Windowsの開発・検証環境ではヘッダーの代わりに環境変数PMREPORT_DEV_USERを使えるが、
 * IIS配下（iisnode）では本番で認証を迂回できないよう環境変数を無視する。
 */
export function resolveUser(req: Request): string | undefined {
  const header = req.header("x-remote-user");
  if (header) return header;
  if (process.env.IISNODE_VERSION) return undefined;
  return process.env.PMREPORT_DEV_USER;
}

export interface AuthedRequest extends Request {
  user?: string;
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const user = resolveUser(req);
  if (!user) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "認証情報が見つかりません" } });
    return;
  }
  (req as AuthedRequest).user = user;
  next();
}
