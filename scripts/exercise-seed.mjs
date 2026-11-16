// Usage: node scripts/exercise-seed.mjs exercises.json > seed-exercises.sql
import { readFileSync } from 'node:fs';

const exercises = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const sql = (s) => (s == null ? 'NULL' : `N'${String(s).replace(/'/g, "''")}'`);
const out = ['SET NOCOUNT ON;', 'DECLARE @id INT;'];
for (const e of exercises) {
  const primary = [...new Set(e.primaryMuscles)];
  // A few records list a muscle as both; keep it as primary only
  const secondary = [...new Set(e.secondaryMuscles)].filter((m) => !primary.includes(m));
  out.push(
    `IF NOT EXISTS (SELECT 1 FROM dbo.Exercises WHERE SourceId = ${sql(e.id)})`,
    'BEGIN',
    `  INSERT INTO dbo.Exercises (Name, Category, Equipment, SourceId) VALUES (${sql(e.name)}, ${sql(e.category)}, ${sql(e.equipment)}, ${sql(e.id)});`,
    '  SET @id = SCOPE_IDENTITY();',
    ...primary.map((m) => `  INSERT INTO dbo.ExerciseMuscles VALUES (@id, ${sql(m)}, 'primary');`),
    ...secondary.map(
      (m) => `  INSERT INTO dbo.ExerciseMuscles VALUES (@id, ${sql(m)}, 'secondary');`,
    ),
    'END',
  );
}
console.log(out.join('\n'));
const muscles = new Set(exercises.flatMap((e) => [...e.primaryMuscles, ...e.secondaryMuscles]));
console.error(`${exercises.length} exercises. Muscles: ${[...muscles].sort().join(', ')}`);
