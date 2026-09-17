(function () {
  "use strict";

  var appInfo = null;

  function $(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    if (value === null || value === undefined) return "-";
    return String(value).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function statusPill(status) {
    return status === "success"
      ? '<span class="pill success"><span class="dot"></span>成功</span>'
      : '<span class="pill danger"><span class="dot"></span>失敗</span>';
  }

  var toastTimer;
  function toast(message) {
    var el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("show");
    }, 3200);
  }

  async function api(path, options) {
    var res = await fetch("/api" + path, options);
    if (!res.ok) {
      var message = "エラーが発生しました (" + res.status + ")";
      try {
        var body = await res.json();
        if (body && body.error && body.error.message) message = body.error.message;
      } catch (_) {
        /* JSON以外のレスポンスはステータスコードのみ通知する */
      }
      throw new Error(message);
    }
    return res.json();
  }

  function switchView(name) {
    ["list", "detail", "history"].forEach(function (view) {
      $("view-" + view).hidden = view !== name;
    });
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (tab) {
      tab.setAttribute("aria-current", tab.getAttribute("data-tab") === name ? "true" : "false");
    });
  }

  function renderReportList(items) {
    var body = $("reportListBody");
    if (items.length === 0) {
      body.innerHTML = '<tr><td colspan="7" class="empty">レポートがまだありません</td></tr>';
      return;
    }
    body.innerHTML = items
      .map(function (item) {
        if (item.status !== "success") {
          return (
            "<tr>" +
            '<td class="mono">' + esc(item.targetDate) + "</td>" +
            "<td>" + statusPill(item.status) + "</td>" +
            '<td class="num">-</td><td class="num">-</td><td class="num">-</td><td class="num">-</td>' +
            '<td><button class="link-btn" data-detail="' + esc(item.targetDate) + '">詳細</button></td>' +
            "</tr>"
          );
        }
        var s = item.summary;
        return (
          "<tr>" +
          '<td class="mono">' + esc(item.targetDate) + "</td>" +
          "<td>" + statusPill(item.status) + "</td>" +
          '<td class="num mono">' + s.newCount + "</td>" +
          '<td class="num mono">' + s.updatedCount + "</td>" +
          '<td class="num mono">' + s.totalSpentHours.toFixed(1) + "h</td>" +
          '<td class="num mono">' + s.delayedCount + "</td>" +
          '<td><button class="link-btn" data-detail="' + esc(item.targetDate) + '">詳細</button>' +
          '<a class="link-btn" href="/api/reports/' + encodeURIComponent(item.targetDate) + '/export">MDエクスポート</a></td>' +
          "</tr>"
        );
      })
      .join("");

    Array.prototype.forEach.call(body.querySelectorAll("[data-detail]"), function (btn) {
      btn.addEventListener("click", function () {
        showDetail(btn.getAttribute("data-detail"));
      });
    });
  }

  function renderDetail(report) {
    $("detailDateTitle").textContent = report.targetDate + " のレポート";
    $("detailMeta").textContent = "生成: " + report.generatedAt;
    var exportBtn = $("exportOneBtn");

    if (report.status !== "success") {
      $("detailSuccess").hidden = true;
      $("detailFailed").hidden = false;
      $("failMessage").textContent = report.errorMessage || "";
      exportBtn.setAttribute("aria-disabled", "true");
      exportBtn.removeAttribute("href");
      return;
    }

    $("detailSuccess").hidden = false;
    $("detailFailed").hidden = true;
    exportBtn.removeAttribute("aria-disabled");
    exportBtn.setAttribute("href", "/api/reports/" + encodeURIComponent(report.targetDate) + "/export");

    var s = report.summary;
    $("statGrid").innerHTML =
      '<div class="stat-tile"><div class="label">新規登録</div><div class="value">' + s.newCount + "<small>件</small></div></div>" +
      '<div class="stat-tile"><div class="label">更新</div><div class="value">' + s.updatedCount + "<small>件</small></div></div>" +
      '<div class="stat-tile"><div class="label">作業時間合計</div><div class="value">' + s.totalSpentHours.toFixed(1) + "<small>h</small></div></div>" +
      '<div class="stat-tile warn"><div class="label">遅延（計算不可含む）</div><div class="value">' + s.delayedCount +
      "<small>件（内" + s.delayedUncalculableCount + "件 計算不可）</small></div></div>";

    $("newIssuesBody").innerHTML = report.newIssues.length
      ? report.newIssues
          .map(function (i) {
            return (
              '<tr><td class="mono">#' + i.id + "</td><td>" + esc(i.subject) + "</td><td>" + esc(i.author) +
              "</td><td>" + esc(i.tracker) + "</td><td>" + esc(i.priority) + "</td><td>" + esc(i.assignee) +
              '</td><td class="mono">' + esc(i.dueDate) + "</td></tr>"
            );
          })
          .join("")
      : '<tr><td colspan="7" class="empty">該当なし</td></tr>';

    $("updatedIssuesBody").innerHTML = report.updatedIssues.length
      ? report.updatedIssues
          .map(function (i) {
            var changes = i.changes
              .map(function (c) {
                return (
                  (c.field === "status" ? "ステータス" : "担当者") + ": " + esc(c.from) +
                  '<span class="arrow">→</span>' + esc(c.to)
                );
              })
              .join("、 ");
            return '<tr><td class="mono">#' + i.id + "</td><td>" + esc(i.subject) + "</td><td>" + changes + "</td></tr>";
          })
          .join("")
      : '<tr><td colspan="3" class="empty">該当なし</td></tr>';

    var maxHours = report.spentTime.reduce(function (max, entry) {
      return Math.max(max, entry.hours);
    }, 0);
    $("spentBars").innerHTML = report.spentTime.length
      ? report.spentTime
          .map(function (entry) {
            var pct = maxHours > 0 ? Math.round((entry.hours / maxHours) * 100) : 0;
            return (
              '<div class="spent-row"><div>' + esc(entry.user) + '</div>' +
              '<div class="bar"><span style="width:' + pct + '%"></span></div>' +
              '<div class="hours">' + entry.hours.toFixed(1) + "h</div></div>"
            );
          })
          .join("")
      : '<div class="empty">該当なし</div>';

    $("delayedBody").innerHTML = report.delayedIssues.length
      ? report.delayedIssues
          .map(function (d) {
            return (
              '<tr><td class="mono">#' + d.id + "</td><td>" + esc(d.subject) + "</td><td>" + esc(d.assignee) +
              '</td><td class="mono">' + esc(d.dueDate) + '</td><td class="num mono">' + d.overdueDays + "日</td>" +
              '<td class="num mono">' + d.estimatedHours.toFixed(1) + 'h</td><td class="num mono">' + d.doneRatio + "%</td>" +
              '<td class="num mono"><strong>' + d.delayHours.toFixed(1) + "h</strong></td></tr>"
            );
          })
          .join("")
      : '<tr><td colspan="8" class="empty">該当なし</td></tr>';

    var uncalc = report.delayedUncalculableIssues;
    $("delayedUncalcWrap").hidden = uncalc.length === 0;
    $("delayedUncalcBody").innerHTML = uncalc
      .map(function (d) {
        return (
          '<tr><td class="mono">#' + d.id + "</td><td>" + esc(d.subject) + "</td><td>" + esc(d.assignee) +
          '</td><td class="mono">' + esc(d.dueDate) + '</td><td class="num mono">' + d.overdueDays + "日</td></tr>"
        );
      })
      .join("");
  }

  function renderHistory(items) {
    var body = $("historyBody");
    if (items.length === 0) {
      body.innerHTML = '<tr><td colspan="6" class="empty">実行履歴がまだありません</td></tr>';
      return;
    }
    body.innerHTML = items
      .map(function (item) {
        var trigger = item.trigger === "scheduled"
          ? '<span class="pill neutral">自動</span>'
          : '<span class="pill warning">手動</span>';
        return (
          '<tr><td class="mono">' + esc(item.startedAt) + '</td><td class="mono">' + esc(item.targetDate) + "</td>" +
          "<td>" + trigger + '</td><td class="mono">' + (item.triggeredBy ? esc(item.triggeredBy) : "—") + "</td>" +
          "<td>" + statusPill(item.status) + "</td><td>" + (item.errorMessage ? esc(item.errorMessage) : "—") + "</td></tr>"
        );
      })
      .join("");
  }

  async function showDetail(date) {
    try {
      var report = await api("/reports/" + encodeURIComponent(date));
      renderDetail(report);
      switchView("detail");
    } catch (err) {
      toast(err.message);
    }
  }

  async function loadList() {
    try {
      var data = await api("/reports");
      renderReportList(data.items);
      initDateInputs(data.items);
    } catch (err) {
      $("reportListBody").innerHTML = '<tr><td colspan="7" class="empty">' + esc(err.message) + "</td></tr>";
    }
  }

  async function loadHistory() {
    try {
      var data = await api("/run-history");
      renderHistory(data.items);
    } catch (err) {
      $("historyBody").innerHTML = '<tr><td colspan="6" class="empty">' + esc(err.message) + "</td></tr>";
    }
  }

  function shiftDate(date, days) {
    var d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function initDateInputs(items) {
    var latest = items.length > 0 ? items[0].targetDate : appInfo ? appInfo.today : null;
    if (!latest) return;
    if (!$("regenDate").value) $("regenDate").value = latest;
    if (!$("rangeTo").value) $("rangeTo").value = latest;
    if (!$("rangeFrom").value) $("rangeFrom").value = shiftDate(latest, -6);
  }

  async function downloadRange() {
    var from = $("rangeFrom").value;
    var to = $("rangeTo").value;
    if (!from || !to) {
      toast("開始日と終了日を指定してください");
      return;
    }
    var url = "/api/reports/export?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to);
    try {
      var res = await fetch(url);
      if (!res.ok) {
        var body = await res.json();
        throw new Error(body && body.error ? body.error.message : "エクスポートに失敗しました");
      }
      var blob = await res.blob();
      var link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "report_" + from + "_" + to + ".md";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
      toast(from + " 〜 " + to + " のレポートをダウンロードしました");
    } catch (err) {
      toast(err.message);
    }
  }

  async function regenerate() {
    var date = $("regenDate").value;
    if (!date) {
      toast("対象日を指定してください");
      return;
    }
    var btn = $("regenBtn");
    btn.disabled = true;
    btn.textContent = "生成中…";
    try {
      var report = await api("/reports/" + encodeURIComponent(date) + "/regenerate", { method: "POST" });
      await loadList();
      await loadHistory();
      toast(
        report.status === "success"
          ? date + " のレポートを再生成しました"
          : date + " のレポート生成に失敗しました: " + report.errorMessage
      );
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "再生成";
    }
  }

  async function init() {
    try {
      var who = await api("/whoami");
      $("whoami").textContent = who.user;
    } catch (err) {
      $("whoami").textContent = "-";
    }
    try {
      appInfo = await api("/app-info");
      var trackers = appInfo.trackers.length > 0 ? appInfo.trackers.join("・") : "全トラッカー";
      $("brandSub").textContent =
        (appInfo.project.identifier || "プロジェクト未設定") +
        (appInfo.project.includeSubprojects ? "（サブプロジェクト含む）" : "") +
        " ・ トラッカー: " + trackers;
      $("rangeHint").textContent =
        "最大" + appInfo.maxRangeDays + "日分をまとめて1つのMarkdownファイルに出力します。";
    } catch (err) {
      /* 設定情報が取れなくても一覧の閲覧自体は継続できる */
    }

    $("mainTabs").addEventListener("click", function (e) {
      var tab = e.target.closest(".tab");
      if (!tab) return;
      switchView(tab.getAttribute("data-tab"));
    });
    $("backToList").addEventListener("click", function () {
      switchView("list");
    });
    $("regenBtn").addEventListener("click", regenerate);
    $("rangeBtn").addEventListener("click", downloadRange);

    await loadList();
    await loadHistory();
  }

  init();
})();
