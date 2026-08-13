

---
https://en.wikipedia.org/wiki/Separable_extension

# Separable extension

In [[field theory]] , a branch of [[algebra]] , an [[algebraic field extension]] $E/F$ is called a **separable extension** if for every $\alpha \in E$ , the [[Minimal polynomial]] of $\alpha$ over `F` is a [[separable polynomial]] (i.e., its [[Formal derivative]] is not the zero [[polynomial]] , or equivalently it has no repeated [[roots]] in any extension field). [[ 1 ]](#cite_note-Isaacs281-1) There is also a more general definition that applies when `E` is not necessarily algebraic over `F` . An extension that is not separable is said to be inseparable .

Every algebraic extension of a [[field]] of [[characteristic]] zero is separable, and every algebraic extension of a [[finite field]] is separable. [[ 2 ]](#cite_note-Isaacs18.11p281-2) It follows that most extensions that are considered in mathematics are separable. Nevertheless, the concept of separability is important, as the existence of inseparable extensions is the main obstacle for extending many theorems proved in characteristic zero to non-zero characteristic. For example, the [[fundamental theorem of Galois theory]] is a theorem about [[normal extensions]] , which remains true in non-zero characteristic only if the extensions are also assumed to be separable. [[ 3 ]](#cite_note-3)

The opposite concept, a [[purely inseparable extension]] , also occurs naturally, as every algebraic extension may be decomposed uniquely as a purely inseparable extension of a separable extension. An algebraic extension $E/F$ of fields of non-zero characteristic `p` is a purely inseparable extension if and only if for every $\alpha \in E\setminus F$ , the minimal polynomial of $\alpha$ over `F` is not a separable polynomial, or, equivalently, for every element `x` of `E` , there is a positive [[integer]] `k` such that $x^{p^{k}}\in F$ . [[ 4 ]](#cite_note-Isaacs298-4)

The simplest nontrivial example of a (purely) inseparable extension is $E=\mathbb {F} _{p}(x)\supseteq F=\mathbb {F} _{p}(x^{p})$ , fields of [[rational functions]] in the indeterminate x with coefficients in the [[finite field]] $\mathbb {F} _{p}=\mathbb {Z} /(p)$ . The element $x\in E$ has minimal polynomial $f(X)=X^{p}-x^{p}\in F[X]$ , having $f'(X)=0$ and a p -fold multiple root, as $f(X)=(X-x)^{p}\in E[X]$ . This is a [[simple]] algebraic extension of degree p , as $E=F[x]$ , but it is not a normal extension since the [[Galois group]] ${\text{Gal}}(E/F)$ is [[trivial]] .

## Informal discussion

An arbitrary polynomial `f` with coefficients in some field `F` is said to have distinct roots or to be [[square-free]] if it has `deg f` roots in some [[extension field]] $E\supseteq F$ . For instance, the polynomial `g(X) = X 2 − 1` has precisely `deg g = 2` roots in the [[complex plane]] ; namely `1` and `−1` , and hence does have distinct roots. On the other hand, the polynomial `h(X) = (X − 2)2` , which is the square of a non-constant polynomial does not have distinct roots, as its degree is two, and `2` is its only root.

Every polynomial may be factored in linear factors over an [[algebraic closure]] of the field of its coefficients. Therefore, the polynomial does not have distinct roots if and only if it is divisible by the square of a polynomial of positive degree. This is the case if and only if the [[greatest common divisor]] of the polynomial and its [[derivative]] is not a constant. Thus for testing if a polynomial is square-free, it is not necessary to consider explicitly any field extension nor to compute the roots.

In this context, the case of irreducible polynomials requires some care. A priori, it may seem that being divisible by a square is impossible for an [[irreducible polynomial]] , which has no non-constant divisor except itself. However, irreducibility depends on the ambient field, and a polynomial may be irreducible over `F` and reducible over some extension of `F` . Similarly, divisibility by a square depends on the ambient field. If an irreducible polynomial `f` over `F` is divisible by a square over some field extension, then (by the discussion above) the greatest common divisor of `f` and its derivative `f′` is not constant. Note that the coefficients of `f′` belong to the same field as those of `f` , and the greatest common divisor of two polynomials is independent of the ambient field, so the greatest common divisor of `f` and `f′` has coefficients in `F` . Since `f` is irreducible in `F` , this greatest common divisor is necessarily `f` itself. Because the degree of `f′` is strictly less than the degree of `f` , it follows that the derivative of `f` is zero, which implies that the [[characteristic]] of the field is a prime number `p` , and `f` may be written

$f(x)=\sum _{i=0}^{k}a_{i}x^{pi}.$

A polynomial such as this one, whose formal derivative is zero, is said to be inseparable . Polynomials that are not inseparable are said to be separable . A separable extension is an extension that may be generated by separable elements , that is elements whose minimal polynomials are separable.

## Separable and inseparable polynomials

An [[irreducible polynomial]] `f` in `F[X]` is [[separable]] if and only if it has distinct roots in any [[extension]] of `F` (that is if it may be factored in distinct linear factors over an [[algebraic closure]] of `F)` . [[ 5 ]](#cite_note-5) Let `f` in `F[X]` be an irreducible polynomial and `f '` its [[Formal derivative]] . Then the following are equivalent conditions for the irreducible polynomial `f` to be separable:

- If `E` is an extension of `F` in which `f` is a product of linear factors then no square of these factors divides `f` in `E[X]` (that is `f` is [[square-free]] over `E` ). [[ 6 ]](#cite_note-IsaacsLem18.7-6)
- There exists an extension `E` of `F` such that `f` has `deg(f)` pairwise distinct roots in `E` . [[ 6 ]](#cite_note-IsaacsLem18.7-6)
- The constant `1` is a [[polynomial greatest common divisor]] of `f` and `f '` . [[ 7 ]](#cite_note-7)
- The formal derivative `f '` of `f` is not the zero polynomial. [[ 8 ]](#cite_note-8)
- Either the characteristic of `F` is zero, or the characteristic is `p` , and `f` is not of the form $\textstyle \sum _{i=0}^{k}a_{i}X^{pi}.$

Since the formal derivative of a positive degree polynomial can be zero only if the field has prime characteristic, for an irreducible polynomial to not be separable, its coefficients must lie in a field of prime characteristic. More generally, an irreducible (non-zero) polynomial `f` in `F[X]` is not separable, if and only if the characteristic of `F` is a (non-zero) prime number `p` , and `f(X)=g(Xp` ) for some irreducible polynomial `g` in `F[X]` . [[ 9 ]](#cite_note-9) By repeated application of this property, it follows that in fact, $f(X)=g(X^{p^{n}})$ for a non-negative integer `n` and some separable irreducible polynomial `g` in `F[X]` (where `F` is assumed to have prime characteristic p ). [[ 10 ]](#cite_note-10)

If the [[Frobenius endomorphism]] $x\mapsto x^{p}$ of `F` is not surjective, there is an element $a\in F$ that is not a `p` th power of an element of `F` . In this case, the polynomial $X^{p}-a$ is irreducible and inseparable. Conversely, if there exists an inseparable irreducible (non-zero) polynomial $\textstyle f(X)=\sum a_{i}X^{ip}$ in `F[X]` , then the [[Frobenius endomorphism]] of `F` cannot be an [[automorphism]] , since, otherwise, we would have $a_{i}=b_{i}^{p}$ for some $b_{i}$ , and the polynomial `f` would factor as $\textstyle \sum a_{i}X^{ip}=\left(\sum b_{i}X^{i}\right)^{p}.$ [[ 11 ]](#cite_note-11)

If `K` is a finite field of prime characteristic p , and if `X` is an [[indeterminate]] , then the [[field of rational functions]] over `K` , `K(X)` , is necessarily [[imperfect]] , and the polynomial `f(Y)=Yp−X` is inseparable (its formal derivative in Y is 0). [[ 1 ]](#cite_note-Isaacs281-1) More generally, if F is any field of (non-zero) prime characteristic for which the [[Frobenius endomorphism]] is not an automorphism, F possesses an inseparable algebraic extension. [[ 12 ]](#cite_note-Isaacs299-12)

A field F is [[perfect]] if and only if all irreducible polynomials are separable. It follows that `F` is perfect if and only if either `F` has characteristic zero, or `F` has (non-zero) prime characteristic `p` and the [[Frobenius endomorphism]] of `F` is an automorphism. This includes every finite field.

## Separable elements and separable extensions

Let $E\supseteq F$ be a field extension. An element $\alpha \in E$ is **separable** over `F` if it is algebraic over `F` , and its [[Minimal polynomial]] is separable (the minimal polynomial of an element is necessarily irreducible).

If $\alpha ,\beta \in E$ are separable over `F` , then $\alpha +\beta$ , $\alpha \beta$ and $1/\alpha$ are separable over F .

Thus the set of all elements in `E` separable over `F` forms a subfield of `E` , called the **separable closure** of `F` in `E` . [[ 13 ]](#cite_note-13)

The separable closure of `F` in an [[algebraic closure]] of `F` is simply called the **[[separable closure]]** of `F` . Like the algebraic closure, it is unique up to an isomorphism, and in general, this isomorphism is not unique.

A field extension $E\supseteq F$ is **separable** , if `E` is the separable closure of `F` in `E` . This is the case if and only if `E` is generated over `F` by separable elements.

If $E\supseteq L\supseteq F$ are field extensions, then `E` is separable over `F` if and only if `E` is separable over `L` and `L` is separable over `F` . [[ 14 ]](#cite_note-14)

If $E\supseteq F$ is a [[finite extension]] (that is `E` is a `F` - [[vector space]] of finite [[dimension]] ), then the following are equivalent.

1. `E` is separable over `F` .
2. $E=F(a_{1},\ldots ,a_{r})$ where $a_{1},\ldots ,a_{r}$ are separable elements of `E` .
3. $E=F(a)$ where `a` is a separable element of `E` .
4. If `K` is an algebraic closure of `F` , then there are exactly $[E:F]$ [[field homomorphisms]] of `E` into `K` that fix `F` .
5. For any normal extension `K` of `F` that contains `E` , then there are exactly $[E:F]$ field homomorphisms of `E` into `K` that fix `F` .

The equivalence of 3. and 1. is known as the primitive element theorem or Artin's theorem on primitive elements . Properties 4. and 5. are the basis of [[Galois theory]] , and, in particular, of the [[fundamental theorem of Galois theory]] .

## Separable extensions within algebraic extensions

Let $E\supseteq F$ be an algebraic extension of fields of characteristic `p` . The separable closure of `F` in `E` is $S=\{\alpha \in E\mid \alpha {\text{ is separable over }}F\}.$ For every element $x\in E\setminus S$ there exists a positive integer `k` such that $x^{p^{k}}\in S,$ and thus `E` is a [[purely inseparable extension]] of `S` . It follows that `S` is the unique intermediate field that is separable over `F` and over which `E` is purely inseparable . [[ 15 ]](#cite_note-15)

If $E\supseteq F$ is a [[finite extension]] , its [[degree]] `[E : F]` is the product of the degrees `[S : F]` and `[E : S]` . The former, often denoted `[E : F]sep` , is referred to as the separable part of `[E : F]` , or as the **separable degree** of `E/F` ; the latter is referred to as the inseparable part of the degree or the **inseparable degree** . [[ 16 ]](#cite_note-Isaacs302-16) The inseparable degree is 1 in characteristic zero and a power of `p` in characteristic `p > 0` . [[ 17 ]](#cite_note-17)

On the other hand, an arbitrary algebraic extension $E\supseteq F$ may not possess an intermediate extension `K` that is purely inseparable over `F` and over which `E` is separable . However, such an intermediate extension may exist if, for example, $E\supseteq F$ is a finite degree normal extension (in this case, `K` is the fixed field of the Galois group of `E` over `F` ). Suppose that such an intermediate extension does exist, and `[E : F]` is finite, then `[S : F] = [E : K]` , where `S` is the separable closure of `F` in `E` . [[ 18 ]](#cite_note-18) The known proofs of this equality use the fact that if $K\supseteq F$ is a purely inseparable extension, and if `f` is a separable irreducible polynomial in `F[X]` , then `f` remains irreducible in K [ X ] [[ 19 ]](#cite_note-19) ). This equality implies that, if `[E : F]` is finite, and `U` is an intermediate field between `F` and `E` , then `[E : F]sep = [E : U]sep⋅[U : F]sep` . [[ 20 ]](#cite_note-20)

The separable closure `Fsep` of a field `F` is the separable closure of `F` in an [[algebraic closure]] of `F` . It is the maximal [[Galois extension]] of `F` . By definition, `F` is [[perfect]] if and only if its separable and algebraic closures coincide.

## Separability of transcendental extensions

Separability problems may arise when dealing with [[transcendental extensions]] . This is typically the case for [[algebraic geometry]] over a field of prime characteristic, where the [[function field of an algebraic variety]] has a [[transcendence degree]] over the ground field that is equal to the [[dimension]] of the variety.

For defining the separability of a transcendental extension, it is natural to use the fact that every field extension is an algebraic extension of a [[purely transcendental extension]] . This leads to the following definition.

A separating transcendence basis of an extension $E\supseteq F$ is a [[transcendence basis]] `T` of `E` such that `E` is a separable algebraic extension of `F(T)` . A [[finitely generated field extension]] is separable if and only it has a separating transcendence basis; an extension that is not finitely generated is called separable if every finitely generated subextension has a separating transcendence basis. [[ 21 ]](#cite_note-FJ38-21)

Let $E\supseteq F$ be a field extension of [[characteristic exponent]] `p` (that is `p = 1` in characteristic zero and, otherwise, `p` is the characteristic). The following properties are equivalent:

- `E` is a separable extension of `F` ,
- $E^{p}$ and `F` are [[linearly disjoint]] over $F^{p},$
- $F^{1/p}\otimes _{F}E$ is [[reduced]] ,
- $L\otimes _{F}E$ is reduced for every field extension `L` of `E` ,

where $\otimes _{F}$ denotes the [[tensor product of fields]] , $F^{p}$ is the field of the `p` th powers of the elements of `F` (for any field `F` ), and $F^{1/p}$ is the field obtained by [[adjoining]] to `F` the `p` th root of all its elements (see [[Separable algebra]] for details).

## Differential criteria

Separability can be studied with the aid of [[derivations]] . Let `E` be a [[finitely generated field extension]] of a field `F` . Denoting $\operatorname {Der} _{F}(E,E)$ the `E` -vector space of the `F` -linear derivations of `E` , one has

$\dim _{E}\operatorname {Der} _{F}(E,E)\geq \operatorname {tr.deg} _{F}E,$

and the equality holds if and only if E is separable over F (here "tr.deg" denotes the [[transcendence degree]] ).

In particular, if $E/F$ is an algebraic extension, then $\operatorname {Der} _{F}(E,E)=0$ if and only if $E/F$ is separable. [[ 22 ]](#cite_note-FJ49-22)

Let $D_{1},\ldots ,D_{m}$ be a basis of $\operatorname {Der} _{F}(E,E)$ and $a_{1},\ldots ,a_{m}\in E$ . Then $E$ is separable algebraic over $F(a_{1},\ldots ,a_{m})$ if and only if the matrix $D_{i}(a_{j})$ is invertible. In particular, when $m=\operatorname {tr.deg} _{F}E$ , this matrix is invertible if and only if $\{a_{1},\ldots ,a_{m}\}$ is a separating transcendence basis.

## Notes

1. ^ [a](#cite_ref-Isaacs281_1-0) [b](#cite_ref-Isaacs281_1-1) Isaacs, p. 281
2. **[^](#cite_ref-Isaacs18.11p281_2-0)** Isaacs, Theorem 18.11, p. 281
3. **[^](#cite_ref-3)** Isaacs, Theorem 18.13, p. 282
4. **[^](#cite_ref-Isaacs298_4-0)** Isaacs, p. 298
5. **[^](#cite_ref-5)** Isaacs, p. 280
6. ^ [a](#cite_ref-IsaacsLem18.7_6-0) [b](#cite_ref-IsaacsLem18.7_6-1) Isaacs, Lemma 18.7, p. 280
7. **[^](#cite_ref-7)** Isaacs, Theorem 19.4, p. 295
8. **[^](#cite_ref-8)** Isaacs, Corollary 19.5, p. 296
9. **[^](#cite_ref-9)** Isaacs, Corollary 19.6, p. 296
10. **[^](#cite_ref-10)** Isaacs, Corollary 19.9, p. 298
11. **[^](#cite_ref-11)** Isaacs, Theorem 19.7, p. 297
12. **[^](#cite_ref-Isaacs299_12-0)** Isaacs, p. 299
13. **[^](#cite_ref-13)** Isaacs, Lemma 19.15, p. 300
14. **[^](#cite_ref-14)** Isaacs, Corollary 18.12, p. 281 and Corollary 19.17, p. 301
15. **[^](#cite_ref-15)** Isaacs, Theorem 19.14, p. 300
16. **[^](#cite_ref-Isaacs302_16-0)** Isaacs, p. 302
17. **[^](#cite_ref-17)** [Lang 2002](#CITEREFLang2002) , Corollary V.6.2
18. **[^](#cite_ref-18)** Isaacs, Theorem 19.19, p. 302
19. **[^](#cite_ref-19)** Isaacs, Lemma 19.20, p. 302
20. **[^](#cite_ref-20)** Isaacs, Corollary 19.21, p. 303
21. **[^](#cite_ref-FJ38_21-0)** Fried & Jarden (2008) p.38
22. **[^](#cite_ref-FJ49_22-0)** Fried & Jarden (2008) p.49

## References

- Borel, A. Linear algebraic groups , 2nd ed.
- P.M. Cohn (2003). Basic algebra
- Fried, Michael D.; Jarden, Moshe (2008). Field arithmetic . Ergebnisse der Mathematik und ihrer Grenzgebiete. 3. Folge. Vol. 11 (3rd ed.). [[Springer-Verlag]] . [[ISBN]] [[978-3-540-77269-9]] . [[Zbl]] [1145.12001](https://zbmath.org/?format=complete&q=an:1145.12001) .
- [[I. Martin Isaacs]] (1993). Algebra, a graduate course (1st ed.). Brooks/Cole Publishing Company. [[ISBN]] [[0-534-19002-2]] .
- [[Kaplansky, Irving]] (1972). Fields and rings . Chicago lectures in mathematics (Second ed.). University of Chicago Press. pp. 55–59. [[ISBN]] [[0-226-42451-0]] . [[Zbl]] [1001.16500](https://zbmath.org/?format=complete&q=an:1001.16500) .
- [[Lang, Serge]] (2002), Algebra , [[Graduate Texts in Mathematics]] , vol. 211 (Revised third ed.), New York: Springer-Verlag, [[ISBN]] [[978-0-387-95385-4]] , [[MR]] [1878556](https://mathscinet.ams.org/mathscinet-getitem?mr=1878556)
- M. Nagata (1985). Commutative field theory: new edition, Shokabo. (Japanese) [[1]](http://www.shokabo.co.jp/mybooks/ISBN978-4-7853-1309-8.htm)
- Silverman, Joseph (1993). The Arithmetic of Elliptic Curves . Springer. [[ISBN]] [[0-387-96203-4]] .

## External links

- ["separable extension of a field k"](https://www.encyclopediaofmath.org/index.php?title=separable_extension_of_a_field_k) , Encyclopedia of Mathematics , [[EMS Press]] , 2001 [1994]

---

*Source: [Separable extension](https://en.wikipedia.org/wiki/Separable_extension) on Wikipedia, by Wikipedia contributors, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Adapted: converted to Markdown, article links rewritten as wikilinks.*
