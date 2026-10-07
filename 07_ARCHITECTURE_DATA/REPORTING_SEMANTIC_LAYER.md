# REPORTING / KPI SEMANTIC LAYER

## Why
Operational reporting must use consistent definitions.

## Core semantic entities
- matter
- stage
- task
- deadline
- communication
- document
- workflow run
- exception
- user/team
- automation decision

## Example defined metrics

### Active Matter
Matter with state open and not archived.

### Stalled Matter
No meaningful qualifying event for configured N days.

### Overdue Task
Open task with due_at < now.

### Automation Rate
Eligible actions executed without manual intervention / eligible actions.

### Human Review Rate
Events routed to human review / processed events.

### Correction Rate
AI/rule proposal changed by human / reviewed proposals.

### Email Handling Time
From receipt to final classified/filed/actioned state.

### Exception Age
Now - exception_created_at.

### Matter Touches
Count of human interactions over period.

## Dashboard audiences

### Legal admin
My queue, pending approvals, failed writes.

### Team leader
Oldest/risky exceptions, workloads, overdue.

### Operations
throughput, automation, stage dwell, staffing demand.

### Partner
capacity, matter progression, risk, client service.

## Natural-language BI
Only over governed semantic metrics and authorised data.
