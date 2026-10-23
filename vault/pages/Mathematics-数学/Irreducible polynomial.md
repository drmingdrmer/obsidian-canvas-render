An **irreducible polynomial** is a nonconstant polynomial that cannot be factored into the product of two nonconstant polynomials. Irreducibility depends on the field of the coefficients: $x^2 - 2$ is irreducible over $\mathbb{Q}$, but over $\mathbb{R}$ it factors as $\left(x - \sqrt{2}\right)\left(x + \sqrt{2}\right)$.

## Examples

$$
\begin{aligned}
x^2 + 4x + 4 &= (x + 2)^2 \\
x^2 - 2 &= \left(x - \sqrt{2}\right)\left(x + \sqrt{2}\right) \\
x^2 + 1 &= (x - i)(x + i)
\end{aligned}
$$

| Polynomial | over $\mathbb{Q}$ | over $\mathbb{R}$ | over $\mathbb{C}$ |
|---|---|---|---|
| $x^2 + 4x + 4$ | reducible | reducible | reducible |
| $x^2 - 2$ | irreducible | reducible | reducible |
| $x^2 + 1$ | irreducible | irreducible | reducible |

Over $\mathbb{C}$, only the polynomials of degree one are irreducible. This is the fundamental theorem of algebra.

## Field extensions

If $P \in K[X]$ is irreducible, then $L = K[X]/(P)$ is a field, and the image of $X$ in $L$ is a root of $P$. So irreducible polynomials build [[Field extension|field extensions]], and every algebraic element has one as its [[Minimal polynomial]]. Repeating the construction with the irreducible factors of any polynomial gives its [[Splitting field]].

---

*Source: [Irreducible polynomial](https://en.wikipedia.org/wiki/Irreducible_polynomial) on Wikipedia, by Wikipedia contributors, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Adapted: condensed, converted to Markdown, article links rewritten as wikilinks.*
