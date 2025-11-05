### Law: auth_break_glass:1.0.0

scope: emergency_override
clock: realtime

if ok:
  requester.role in ["ops","security"] AND approvers.count >= 2 AND ttl_hours <= 24
then:
  permit,
  tag(key=override_active,val=true),
  append_ledger,
  notify(role=audit)

if doubt:
  requester.role in ["ops","security"] AND approvers.count == 1
then:
  hold(hours=1),
  notify(role=security_lead),
  append_ledger

if not:
  true
then:
  deny,
  append_ledger,
  notify(role=security)
