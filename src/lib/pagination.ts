export async function collectPages<T>(
  fetchPage: (
    offset: number,
    size: number,
  ) => Promise<{ rows: T[]; total: number | null }>,
  size = 500,
) {
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchPage(offset, size);
    rows.push(...page.rows);
    offset += page.rows.length;
    if (
      !page.rows.length ||
      (page.total !== null ? offset >= page.total : page.rows.length < size)
    )
      return rows;
  }
}
