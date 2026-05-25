/**
 * Parsers for Magento Cloud CLI output
 */

/**
 * Parses TSV (tab-separated values) output into an array of objects.
 * Used with `--format tsv --no-header` from magento-cloud CLI commands.
 *
 * @param raw  The raw TSV output string
 * @param columns  The column names to use as object keys (in order)
 *
 * Example:
 *   parseTsv("abc\tFoo\tus-3\ndef\tBar\tus-5", ["id", "title", "region"])
 *
 * Returns:
 * [
 *   { "id": "abc", "title": "Foo", "region": "us-3" },
 *   { "id": "def", "title": "Bar", "region": "us-5" }
 * ]
 */
export function parseTsv(raw: string, columns: string[]): Record<string, string>[] {
  const lines = raw
    .split("\n")
    .filter((line) => line.trim().length > 0);

  return lines.map((line) => {
    const values = line.split("\t");
    const row: Record<string, string> = {};
    for (let i = 0; i < columns.length; i++) {
      row[columns[i]] = (values[i] ?? "").trim();
    }
    return row;
  });
}

