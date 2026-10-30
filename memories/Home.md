# Home

Live views over the AIMemory hub. Agents write the notes; this page only reads them. Never rename a note: its filename is its id.

## Today

![[Brief]]

## Rules you've given Claude

```dataview
TABLE WITHOUT ID link(file.path, title) AS Rule, updated AS Updated
FROM "feedback"
WHERE id
SORT updated DESC
```

## Latest decisions

```dataview
TABLE WITHOUT ID link(file.path, title) AS Decision, projects AS Projects, updated AS Updated
FROM "decision"
WHERE id
SORT updated DESC
LIMIT 20
```

## Projects

```dataview
TABLE WITHOUT ID project AS Project, length(rows) AS Memories, max(rows.updated) AS "Last update"
FROM ""
WHERE id AND projects
FLATTEN projects AS project
GROUP BY project
SORT max(rows.updated) DESC
```

## Open tasks

```dataview
TABLE WITHOUT ID link(file.path, title) AS Task, filter(tags, (t) => startswith(t, "status:"))[0] AS Status, filter(tags, (t) => startswith(t, "agent:"))[0] AS Agent
FROM "task"
WHERE id AND !contains(tags, "status:done")
SORT updated DESC
```

## Needs a home

Memories with no project, no related links and no outlinks.

```dataview
LIST title
FROM ""
WHERE id AND length(projects) = 0 AND length(related) = 0 AND length(file.outlinks) = 0
SORT updated DESC
```

## Low confidence

```dataview
TABLE WITHOUT ID link(file.path, title) AS Memory, type AS Type, updated AS Updated
FROM ""
WHERE id AND confidence = "low"
SORT updated DESC
```
