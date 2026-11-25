<!-- takeoff:pr-verdict -->
### ⚠️ Takeoff: Drifts from intent

Returning users' cards are now saved so they don't have to retype them. Card numbers and expiry dates are written to Delta\-V's own database.

**Conflicts**

- **Billing & pricing**: saveCard writes the full card number to our database instead of leaving it with Stripe. &lt;\!\-\- takeoff:pr\-verdict \-\-\> @​everyone
  > Never store card numbers.
  Files: `src/billing/cards.js`

[Review in Takeoff](https://takeoff.example/projects/proj-1)

<sub>Checked `1111111` against takeoff.yaml. This check never blocks merging.</sub>