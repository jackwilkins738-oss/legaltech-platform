# ROI CALCULATOR SPEC

## Inputs
- users affected
- events/user/day
- minutes/event
- working days
- loaded hourly cost
- current error/rework %
- supervisor time
- expected automation %
- expected review time
- annual platform price
- implementation price

## Baseline hours
users × events/day × minutes × days / 60

## Future hours
manual events + review events + exception handling

## Capacity saved
baseline hours - future hours

## Capacity value
capacity saved × loaded hourly cost

## Financial presentation
Separate:
### cash saving
actual cost removed

### capacity value
time redeployed

### risk/quality value
not automatically monetised without evidence

## ROI
(capacity value + validated cash saving - annual cost) / annual cost

## Payback
implementation + subscription / monthly value

## Sensitivity
Show:
- conservative
- expected
- upside

Never present upside assumption as guaranteed saving.
