# Timing precision and task boundaries

## Precision
For tasks under five minutes, record start/end at **second-level precision** where practical. Do not round a 25-second action to one minute.

For longer activities, second-level timestamps are still preferable because they preserve sequence and allow later aggregation.

## Start rule
Start when the worker begins the task-specific action, not when they verbally describe it.

## End rule
End when:
- the required output/action is completed;
- control is handed off;
- the task is suspended for an unrelated task; or
- the task enters genuine waiting.

## Separate time classes
Do not collapse:
- human active handling;
- reading/thinking/judgement;
- system latency;
- external waiting;
- interruption;
- supervisor review.

## Concurrent work
Do not double-count the same wall-clock second across two tasks. If the worker genuinely performs co-occurring work, record the primary task and note concurrency for later interpretation.

## Batch work
Do not divide batch time by item count unless items are sufficiently homogeneous and the batch boundary is clear.

## Outliers
Never delete an outlier just because it is large. Classify whether it is:
- normal but variable;
- interrupted;
- exceptional matter;
- system issue;
- rework/error;
- misclassified task.
