An algebraic [[Field extension]] $L/K$ is **normal** if every [[Irreducible polynomial|irreducible]] polynomial over $K$ that has a root in $L$ splits into linear factors over $L$. For a finite extension, this is the same as $L$ being the [[Splitting field]] of a polynomial over $K$.

## Examples

- $\mathbb{Q}(\sqrt{2})/\mathbb{Q}$ is normal, as the splitting field of $x^2 - 2$.
- $\mathbb{Q}(\sqrt[3]{2})/\mathbb{Q}$ is not. The polynomial $x^3 - 2$ has the root $\sqrt[3]{2}$ in it, but its other two roots are not real. The map $\sqrt[3]{2} \mapsto \omega\sqrt[3]{2}$ embeds $\mathbb{Q}(\sqrt[3]{2})$ in $\overline{\mathbb{Q}}$, and is not an automorphism of it.
- For a prime $p$, $\mathbb{Q}(\sqrt[p]{2}, \zeta_p)$ is normal of degree $p(p - 1)$, as the splitting field of $x^p - 2$.

## Properties

- If $L/K$ is normal and $K \subseteq E \subseteq L$, then $L/E$ is normal.
- If $E$ and $F$ are normal over $K$ inside $L$, so are the compositum $EF$ and the intersection $E \cap F$.

An extension that is normal and [[Separable extension|separable]] is a [[Galois extension]].

---

*Source: [Normal extension](https://en.wikipedia.org/wiki/Normal_extension) on Wikipedia, by Wikipedia contributors, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Adapted: condensed, converted to Markdown, article links rewritten as wikilinks.*
