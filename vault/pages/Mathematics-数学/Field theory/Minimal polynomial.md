The **minimal polynomial** of an element $\alpha$ of a [[Field extension]] $E/F$ is the monic polynomial of lowest degree in $F[x]$ that has $\alpha$ as a root. It exists exactly when $\alpha$ is algebraic over $F$, and then it is unique.

## Properties

The polynomials in $F[x]$ that vanish at $\alpha$ form an ideal $J_\alpha$, the kernel of the map $g \mapsto g(\alpha)$. The minimal polynomial $m_\alpha$ generates this ideal, so:

- $m_\alpha$ divides every polynomial that has $\alpha$ as a root;
- $m_\alpha$ is [[Irreducible polynomial|irreducible]], and is the only monic irreducible polynomial with the root $\alpha$;
- $F(\alpha) \cong F[x]/(m_\alpha)$, so $[F(\alpha) : F] = \deg m_\alpha$.

## Examples

| $\alpha$ | over | minimal polynomial |
|---|---|---|
| $\sqrt{2}$ | $\mathbb{Q}$ | $x^2 - 2$ |
| $\sqrt{2}$ | $\mathbb{R}$ | $x - \sqrt{2}$ |
| $\sqrt{2} + \sqrt{3}$ | $\mathbb{Q}$ | $x^4 - 10x^2 + 1$ |

The roots of $x^4 - 10x^2 + 1$ are $\pm\sqrt{2} \pm \sqrt{3}$, the images of $\sqrt{2} + \sqrt{3}$ under the [[Galois group]] of $\mathbb{Q}(\sqrt{2}, \sqrt{3})/\mathbb{Q}$.

An extension in which every element has a [[Separable polynomial|separable]] minimal polynomial is a [[Separable extension]].

---

*Source: [Minimal polynomial (field theory)](https://en.wikipedia.org/wiki/Minimal_polynomial_(field_theory)) on Wikipedia, by Wikipedia contributors, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Adapted: condensed, converted to Markdown, article links rewritten as wikilinks.*
