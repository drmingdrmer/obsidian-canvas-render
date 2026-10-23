The **primitive element theorem** states that every finite [[Separable extension]] is simple: a single element, called a primitive element, generates it. So every algebraic number field is simple, and so is every extension of [[Finite field|finite fields]].

## Example

Adjoining $\sqrt{2}$ and $\sqrt{3}$ to $\mathbb{Q}$ gives $E = \mathbb{Q}(\sqrt{2}, \sqrt{3})$, of degree $4$. Take $\alpha = \sqrt{2} + \sqrt{3}$. Writing $1, \alpha, \alpha^2, \alpha^3$ in the basis $1, \sqrt{2}, \sqrt{3}, \sqrt{6}$ and solving gives

$$\sqrt{2} = \tfrac{1}{2}\left(\alpha^3 - 9\alpha\right), \qquad \sqrt{3} = -\tfrac{1}{2}\left(\alpha^3 - 11\alpha\right),$$

so $\mathbb{Q}(\sqrt{2}, \sqrt{3}) = \mathbb{Q}(\sqrt{2} + \sqrt{3})$. The [[Minimal polynomial]] of $\alpha$ is $x^4 - 10x^2 + 1$.

## Characteristic p

Without separability, the theorem can fail. Take $E = \mathbb{F}_p(T, U)$ and $F = \mathbb{F}_p(T^p, U^p)$, so that $[E : F] = p^2$. The [[Frobenius endomorphism]] puts $\alpha^p$ in $F$ for every $\alpha \in E$, so every $\alpha$ has degree at most $p$ over $F$, and no single element generates $E$.

---

*Source: [Primitive element theorem](https://en.wikipedia.org/wiki/Primitive_element_theorem) on Wikipedia, by Wikipedia contributors, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Adapted: condensed, converted to Markdown, article links rewritten as wikilinks.*
