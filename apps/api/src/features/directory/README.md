# The directory (spec 023)

The organization as the team's apps read it, with the person's token. See
[the spec](../../../../../specs/023-directory-and-approvals/spec.md).

| Route                              | Who sees it                                                     |
| ---------------------------------- | --------------------------------------------------------------- |
| `GET /v1/directory/me`             | anyone in the chart: her positions, managers, reports           |
| `GET /v1/directory/people/:userId` | herself, her managers and reports, « structure:read » over them |
| `GET /v1/directory/units/:unitId`  | whoever belongs to it, « structure:read » over it               |

Answers are drawn from one read of the chart at a date (`readChartAt`) and the reporting lines of
spec 002: a manager is found where the position reports to, past vacant ones, interim included.
