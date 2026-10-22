# Share draft (not sent)

**do: small models click, a large model only writes when it has to**

Computer-use agents usually send screenshots to a big vision model and ask it where to click. do lists the controls on the page in code and lets Clef, Cloudflare's small decision model, pick one.

New since the first write-up:

- **Harder tasks.** 10 tasks give values in plain language ("my work address: jordan at cloudflare dot com", "a one-word thank-you") instead of quoting them.
- **Relay arm.** Clef asks one yes/no question first: does this task need text that is not in it word for word? If yes, a large model writes the field values once. Clef still makes every click.
- **Results, 30 tasks × 3 repeats:** relay 30/30 at $0.0016 a task. Clef + Clairic alone 25/30. Opus vision 22.7/30 at $0.029. Opus planning + Clef 22/30.
- **Honest limit:** the relay gate scores two of the generation tasks only just above its 0.5 threshold, so it is the weakest part. The test app is also easy for code to read.

Video (38 s, real recording): docs/demo-relay.mp4
Repo: github.com/acoyfellow/do. Every run record, its settings and the exact commit are in evals/runs/bench-3.
