/** Presentation shared by downloaded HTML, print PDFs and legacy HTML/Excel exports. */
export const REPORT_VISUAL_CSS = `
body{font-family:Arial,sans-serif;color:#163344;background:#fff;line-height:1.5}
h1,h2,h3{color:#163344;letter-spacing:0}h1{font-size:26px}h2{font-size:20px}
p{color:#526b7a;font-size:12px}table{border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:11px}
th{background:#163344;color:#fff;font-weight:700;text-align:left}th,td{padding:9px 10px;border:1px solid #cfdee6;vertical-align:top}td{color:#163344}tr:nth-child(even) td{background:#f2f8fc}
.export-hero,.pdf-header{border-radius:8px;border:1px solid #cfdee6;border-top:3px solid #096d94;background:#fff;color:#163344;padding:20px}
.export-hero h1,.export-section-title{color:#163344}.export-hero p{color:#526b7a}
.export-table{border:1px solid #cfdee6;border-radius:8px;background:#fff;padding:16px}
.export-table th{background:#163344;color:#fff;letter-spacing:0;text-transform:none}.export-table td{color:#163344}
@media print{thead{display:table-header-group}tr{break-inside:avoid}h2,h3{break-after:avoid}.export-table{break-inside:auto}th{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
`;
