# Writer eval: writer-2

44 cases, prompt `plain`. Spend $0.0135.

| writer | accuracy | normalize | combine | compose | extract | abstain | $/case | median ms | errors |
|---|---|---|---|---|---|---|---|---|---|
| glm-5.3-flash>kimi-k2.6 | **41/44** | 16/16 | 7/8 | 10/11 | 4/4 | 4/5 | $0.000078 | 3883 | 0 |
| kimi-k2.6 | **41/44** | 15/16 | 7/8 | 11/11 | 4/4 | 4/5 | $0.000159 | 2827 | 0 |
| glm-5.3-flash | **40/44** | 14/16 | 7/8 | 10/11 | 4/4 | 5/5 | $0.000070 | 3340 | 0 |
