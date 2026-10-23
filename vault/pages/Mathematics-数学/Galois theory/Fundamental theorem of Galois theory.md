For a finite [[Galois extension]] $E/F$, the **fundamental theorem of Galois theory** gives a one-to-one correspondence between the intermediate fields $F \subseteq K \subseteq E$ and the subgroups $H$ of the [[Galois group]] $G = \operatorname{Gal}(E/F)$:

$$H \mapsto E^H = \{x \in E \mid \sigma(x) = x \text{ for all } \sigma \in H\}, \qquad K \mapsto \operatorname{Gal}(E/K).$$

## Properties

- It reverses inclusion: $H_1 \subseteq H_2$ if and only if $E^{H_1} \supseteq E^{H_2}$.
- It turns orders into degrees: $|H| = [E : E^H]$ and $|G|/|H| = [E^H : F]$.
- $E^H/F$ is Galois if and only if $H$ is a normal subgroup of $G$, and then $\operatorname{Gal}(E^H/F) \cong G/H$.

## Example

$E = \mathbb{Q}(\sqrt{2}, \sqrt{3})$ has degree $4$ over $\mathbb{Q}$. An automorphism of $E$ sends $\sqrt{2}$ to $\pm\sqrt{2}$, and $\sqrt{3}$ to $\pm\sqrt{3}$. Let $f$ change the sign of $\sqrt{2}$, and $g$ the sign of $\sqrt{3}$. Then $G = \{1, f, g, fg\}$ is the Klein four-group, and its five subgroups match the five intermediate fields:

| Subgroup | Fixed field |
|---|---|
| $\{1\}$ | $\mathbb{Q}(\sqrt{2}, \sqrt{3})$ |
| $\{1, f\}$ | $\mathbb{Q}(\sqrt{3})$ |
| $\{1, g\}$ | $\mathbb{Q}(\sqrt{2})$ |
| $\{1, fg\}$ | $\mathbb{Q}(\sqrt{6})$ |
| $G$ | $\mathbb{Q}$ |

Without separability, the correspondence fails: a [[Purely inseparable extension]] of degree $p$ has only the identity automorphism.

---

*Source: [Fundamental theorem of Galois theory](https://en.wikipedia.org/wiki/Fundamental_theorem_of_Galois_theory) on Wikipedia, by Wikipedia contributors, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Adapted: condensed, converted to Markdown, article links rewritten as wikilinks.*
