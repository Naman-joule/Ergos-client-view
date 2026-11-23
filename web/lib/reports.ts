// Savings sheets (daily statement files). ergOS stores, on each iex_tod_daily_obligation row, where the
// day's files are: an Excel savings sheet, a Word statement, a PDF report and a ZIP bundle. They live on
// ergOS's FTP server, so the app fetches them server-side and streams them to the browser. The browser
// only ever names (plant, date, kind); the path always comes from the row the user is allowed to see.
//
// Env (server only, never NEXT_PUBLIC):
//   REPORTS_FTP_URL           ftp://user:pass@host:21/  or  ftps://…  (a READ-ONLY account for the reports folder)
//   REPORTS_FTP_ROOT          optional: only paths under this folder may be served, e.g. /reports
//   REPORTS_FTP_STRIP_PREFIX  optional: prefix to remove from stored paths, when ergOS stores server-local
//                             paths (e.g. /home/ergos/ftp) that differ from what the FTP login sees
import 'server-only';

export * from './report-path.ts';
