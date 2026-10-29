---
name: "FL privacy benchmark"
course: "mains"
tag: "PyTorch · privacy"
summary: "A benchmark that measures how much private training data leaks from federated learning updates. A gradient inversion attack rebuilds recognisable faces from one client's update, and the benchmark tests whether differential privacy and an encryption-style defence stop it."
status: "published"
contribution: "Team project, in the repository of my teammate imaddde867. I built an early version of the gradient inversion attack, and the differential privacy and encryption defences in the federated learning simulation."
context: "Innovation Project course at Turku UAS, 2025."
stack:
  - "Python"
  - "PyTorch"
  - "CelebA"
  - "Differential privacy"
sourceUrl: "https://github.com/imaddde867/FL-Attack"
demoUrl: "https://imaddde867.github.io/FL-Attack/"
image: "/images/projects/fl-reconstructions.webp"
imageAlt: "Grid of original faces next to faces reconstructed from gradients, across every attack method and defence in the benchmark"
order: 2
draftCopy: false
---

## The question

Federated learning keeps training data on each client and only shares model updates. The usual claim is that this keeps the data private. A gradient inversion attack tests that claim: it starts from noise and optimises an image until its gradient matches the gradient the client sent.

## What the benchmark does

It simulates federated training on 64×64 CelebA faces with a model of about 8.76 million parameters, captures a single client's gradient before aggregation and attacks it. Then it repeats the attack with defences switched on.

| Configuration | PSNR (dB) | LPIPS, lower is closer |
|---|---|---|
| No defence | 29.38 | 0.117 |
| Local DP, ε = 1 | 6.32 | 0.747 |
| Quantise + noise ("HE" setting) | 14.03 | 0.635 |
| Local DP, ε = 1, plus "HE" | 6.37 | 0.824 |

Without a defence, the attack rebuilds faces you can recognise from one update. With local differential privacy, the reconstructions turn to noise.

## What the numbers do not prove

The repository write-up is explicit about the limits.

- **Every ε looks the same.** ε = 8, 1 and 0.1 all land between 6.3 and 6.7 dB. That is not a bug. With 8.76 million parameters, the Gaussian noise grows with the square root of the dimension, so even ε = 8 already swamps the signal. The chosen range could never have shown graduated protection.
- **The "HE" row is not encryption.** At this model size the code quantises the gradient and adds fixed noise. It never runs real Paillier encryption, and a real secure aggregation setup would never hand the attacker a decrypted update.
- **Utility is not measured.** The benchmark measures attack quality only, so it says nothing about how much accuracy each defence costs.

The live dashboard has the full reconstructions and ablations.
