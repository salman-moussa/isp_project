export function normalizeCatalogSql(value, schemaName) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replaceAll(`"${schemaName}".`, '')
    .replaceAll(`${schemaName}.`, '')
    .replaceAll(/\s+/gu, ' ')
    .trim();
}

export function normalizeCatalogRows(rows, schemaName, sqlFields = []) {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        sqlFields.includes(key) ? normalizeCatalogSql(value, schemaName) : value,
      ]),
    ),
  );
}

export function assertExactCatalogManifest(actual, reference) {
  for (const section of Object.keys(reference)) {
    if (JSON.stringify(actual[section]) !== JSON.stringify(reference[section])) {
      throw new Error(
        `Legacy schema ${section} do not match a freshly applied immutable Orvex baseline`,
      );
    }
  }
}
