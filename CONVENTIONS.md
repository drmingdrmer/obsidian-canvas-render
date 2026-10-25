# Conventions for a board

A board should tell a reader what each card is, and why two cards are joined, before any card is opened. Three things on a board carry that: a card's colour, the sides an edge joins, and an edge's colour. The rules below give each of them one meaning. `vault/demo.canvas` follows them, and so should any board written for this renderer, by a person or by a model.

Each colour means one thing, on a card and on an edge:

| Colour | `color` | On a card | On an edge |
|---|---|---|---|
| None | — | A concept | A dependency |
| ![](assets/colors/1.svg) Red | `"1"` | A warning | — |
| ![](assets/colors/2.svg) Orange | `"2"` | — | — |
| ![](assets/colors/3.svg) Yellow | `"3"` | An explanation | — |
| ![](assets/colors/4.svg) Green | `"4"` | An example | To an example or another detail |
| ![](assets/colors/5.svg) Cyan | `"5"` | A theorem | — |
| ![](assets/colors/6.svg) Purple | `"6"` | — | To a related topic |

![](assets/colors/2.svg) Orange means nothing on a card or on an edge, because the previews of `Out` use it. No hex colour means anything either. A group's colour has no meaning: it only tells the group from the groups beside it.

## A card's colour names its kind

The JSON Canvas format gives a card one attribute of style, `color`. It takes one of Obsidian's six preset colours, `"1"` to `"6"`, or a hex colour written `"#rrggbb"`. A card's other attributes are its type, its content, its size and its place, so its kind goes in its colour:

- A concept takes no colour. A concept card defines one idea, or gathers what is known about it, such as `Field extension`. Most cards are concepts, so the colours stand out on the few cards that are not. A heading, such as the text card that names the board, takes no colour either.
- A theorem is ![](assets/colors/5.svg) cyan. A theorem card states a result that follows from the cards before it: a theorem, a proposition, a lemma or a corollary, such as `Primitive element theorem`.
- An explanation is ![](assets/colors/3.svg) yellow. An explanation card shows why something holds: a proof, a derivation, or the idea behind a definition.
- An example is ![](assets/colors/4.svg) green. An example card works through one case, such as the field ℚ(√2, √3), or shows a case where a statement fails.
- A warning is ![](assets/colors/1.svg) red. A warning card points out an error to avoid: a common mistake, or a condition that is easy to miss. For example, a rule that holds in characteristic 0 can fail in characteristic p. Red marks nothing else, so that it always calls for care.

An explanation, an example or a warning hangs below the card it serves, joined to that card's bottom side. That edge is ![](assets/colors/4.svg) green for all three. A figure takes the kind of what it shows. `Galois correspondence.svg` on the demo board draws the correspondence for ℚ(√2, √3) alone, so it is an example.

A group frames the cards of one area, and its label names the area. Its colour only tells it from the groups beside it, so any colour serves but ![](assets/colors/1.svg) red, which stays for warnings.

## An edge's sides and colour name what it joins

Each side of a card joins one kind of card, so that a reader knows what an edge means from where it meets the card:

- The left side of a card joins the cards to read before it, and the right side joins the cards to read after it. A dependency edge runs from the right side of a card to the left side of a card that builds on it, with its arrow at the second card. The board then reads from left to right in the order to learn it.
- The top side joins related topics. A related topic is worth reading beside the card, but the card does not build on it. A concept and its opposite are related topics, such as separable and purely inseparable extensions. So are one idea in two settings, such as the formal derivative of a polynomial and the derivative in calculus. So are two ideas that a third one combines, such as normal and separable extensions, which together make a Galois extension.
- The bottom side joins examples, explanations, warnings, figures and other details that the card can do without. Taking such a card off the board leaves the rest of the board whole.

The colour of an edge repeats its kind. A dependency edge keeps the default ![](assets/colors/grey.svg) grey. An edge to a related topic is ![](assets/colors/6.svg) purple, Obsidian's preset colour `"6"`, and an edge to an example or a detail is ![](assets/colors/4.svg) green, preset colour `"4"`. The colour shows the kind along the whole edge, not only where the edge meets a card. An edge to an example joins the bottom side of a card to the top side of the example. A top side also joins related topics, so at the example's end only the colour tells the two kinds apart.
