SELECT name, type
FROM sqlite_schema
WHERE type IN ('table','index')
  AND name NOT LIKE 'sqlite_%'
ORDER BY type, name;

PRAGMA foreign_key_check;
