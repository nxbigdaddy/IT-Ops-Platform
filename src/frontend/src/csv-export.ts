// CSV export helpers: quoting must survive commas, quotes and newlines in server-supplied text.
export function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}
export function csvText(header: readonly string[], rows: readonly (readonly string[])[]): string {
  // The BOM keeps Excel from mis-decoding Chinese headers; a trailing newline ends the last row.
  return `\uFEFF${[header, ...rows].map(row => row.map(csvCell).join(',')).join('\n')}\n`
}
export function downloadCsv(filename: string, header: readonly string[], rows: readonly (readonly string[])[]): void {
  const url = URL.createObjectURL(new Blob([csvText(header, rows)], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
