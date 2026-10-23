A **splitting field** of a polynomial $p$ over a [[Field]] $K$ is the smallest [[Field extension]] of $K$ over which $p$ splits into linear factors. It is generated over $K$ by the roots of $p$, and it is unique up to isomorphism.

For example, $x^2 - 2$ does not factor over $\mathbb{Q}$. Its splitting field is $\mathbb{Q}(\sqrt{2})$, the smallest extension that contains $\sqrt{2}$ and $-\sqrt{2}$.

## Construction

Adjoin one root at a time: take an [[Irreducible polynomial|irreducible]] factor $f$ of $p$ that is not linear over $K_i$, and pass from $K_i$ to $K_{i+1} = K_i[X]/(f)$. Inside an [[Algebraic closure]] of $K$, the splitting field is simply the field that the roots of $p$ generate there.

## Cubic example

Over $\mathbb{Q}$, the roots of $x^3 - 2$ are $\sqrt[3]{2}$, $\omega\sqrt[3]{2}$ and $\omega^2\sqrt[3]{2}$, where

$$\omega = -\frac{1}{2} + \frac{\sqrt{3}}{2}i$$

is a primitive cube root of unity. The field $\mathbb{Q}(\sqrt[3]{2})$ holds only the real root, so the splitting field is larger:

$$L = \mathbb{Q}\left(\sqrt[3]{2}, \omega\right), \qquad [L : \mathbb{Q}] = 6.$$

A splitting field of a set of polynomials is a [[Normal extension]], and a splitting field of separable polynomials is a [[Galois extension]].

---

*Source: [Splitting field](https://en.wikipedia.org/wiki/Splitting_field) on Wikipedia, by Wikipedia contributors, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Adapted: condensed, converted to Markdown, article links rewritten as wikilinks.*
