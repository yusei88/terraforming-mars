# Phase 2 カバレッジ監査 — 基本セット・企業時代

`scripts/coach/coverageReport.ts` が生成（手で編集しない）。分類の意味:

- **supported**: カードの全効果が固定値の効果原子（EffectAtom）になっている。プレイ時効果は実エンジンとの差分テストで全件一致（`golden.spec.ts`）。
- **partial**: 一部が効果原子、残りは未解析（理由付き）。このカードを含む合計値は厳密ではない。
- **unsupported**: 効果原子がなく、すべて未解析。
- **none**: 効果がない。

カタログ版: `96e3a55227c5e380`

## 集計

| モジュール | 枚数 | supported | partial | unsupported | none | 要件を評価できないカード |
|---|---|---|---|---|---|---|
| base | 148 | 62 | 64 | 22 | 0 | 10 |
| corpera | 73 | 36 | 16 | 20 | 1 | 5 |

## 未解析の種類（効果の件数）

| 種類 | 件数 |
|---|---|
| bespoke-code | 80 |
| tile-placement | 34 |
| target-choice | 20 |
| countable | 16 |
| choice | 7 |
| conditional-cost | 5 |
| other | 2 |
| special-vp | 1 |

## カード別

| カード | モジュール | 種別 | 分類 | 効果原子 | 未解析（理由） | 要件 |
|---|---|---|---|---|---|---|
| Adaptation Technology | base | active | **supported** | VP 1<br>requirement bonus 2 | — | — |
| Adapted Lichen | base | automated | **supported** | onPlay:production plants +1 | — | — |
| Advanced Ecosystems | base | automated | **supported** | VP 3 | — | 1 plant<br>1 animal<br>1 microbe |
| Aerobraked Ammonia Asteroid | base | event | **partial** | onPlay:production heat +3<br>onPlay:production plants +1 | onPlay:addResourcesToAnyCard — the target card or player is chosen when played | — |
| Algae | base | automated | **supported** | onPlay:production plants +2<br>onPlay:stock plants +1 | — | oceans 5 |
| Ants | base | active | **partial** | action:+1 resource here<br>VP 1/2 resources | action:removeResourcesFromAnyCard — the target card or player is chosen when played | oxygen 4 |
| Aquifer Pumping | base | active | **partial** | action:spend megacredits 8 | action:spend.canUseSteel — the cost may be paid with steel or titanium instead<br>action:ocean — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | — |
| ArchaeBacteria | base | automated | **supported** | onPlay:production plants +1 | — | max temperature -18 |
| Arctic Algae | base | active | **partial** | onPlay:stock plants +1 | static:onTilePlaced — card code 'onTilePlaced' changes what the card does | max temperature -12 |
| Artificial Lake | base | automated | **partial** | VP 1 | onPlay:ocean — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | temperature -6<br>**not evaluated**: card-specific play condition (bespokeCanPlay) |
| Artificial Photosynthesis | base | automated | **unsupported** | — | onPlay:or — the player chooses one of several effects | — |
| Asteroid | base | event | **partial** | onPlay:stock titanium +2<br>onPlay:temperature +1 step | onPlay:removeAnyPlants — the target card or player is chosen when played | — |
| Asteroid Mining | base | automated | **supported** | onPlay:production titanium +2<br>VP 2 | — | — |
| Beam From A Thorium Asteroid | base | automated | **supported** | onPlay:production heat +3<br>onPlay:production energy +3<br>VP 1 | — | 1 jovian |
| Beginner Corporation | base | corporation | **supported** | onPlay:draw 10<br>starting M€ 42 | — | — |
| Big Asteroid | base | event | **partial** | onPlay:stock titanium +4<br>onPlay:temperature +2 step | onPlay:removeAnyPlants — the target card or player is chosen when played | — |
| Biomass Combustors | base | automated | **partial** | onPlay:production energy +2<br>VP -1 | onPlay:decreaseAnyProduction — the target card or player is chosen when played | oxygen 6 |
| Birds | base | active | **partial** | action:+1 resource here<br>VP 1/1 resources | onPlay:decreaseAnyProduction — the target card or player is chosen when played | oxygen 13 |
| Black Polar Dust | base | automated | **partial** | onPlay:production megacredits -2<br>onPlay:production heat +3 | onPlay:ocean — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | — |
| Breathing Filters | base | automated | **supported** | VP 2 | — | oxygen 7 |
| Bushes | base | automated | **supported** | onPlay:production plants +2<br>onPlay:stock plants +2 | — | temperature -10 |
| Capital | base | automated | **partial** | onPlay:production energy -2<br>onPlay:production megacredits +5 | onPlay:tile — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled<br>victoryPoints:victoryPoints — victory points depend on oceans, nextToThis | oceans 4 |
| Carbonate Processing | base | automated | **supported** | onPlay:production energy -1<br>onPlay:production heat +3 | — | — |
| Cloud Seeding | base | automated | **partial** | onPlay:production megacredits -1<br>onPlay:production plants +2 | onPlay:decreaseAnyProduction — the target card or player is chosen when played | oceans 3 |
| Colonizer Training Camp | base | automated | **supported** | VP 2 | — | max oxygen 5 |
| Comet | base | event | **partial** | onPlay:temperature +1 step | onPlay:ocean — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled<br>onPlay:removeAnyPlants — the target card or player is chosen when played | — |
| Convoy From Europa | base | event | **partial** | onPlay:draw 1 | onPlay:ocean — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | — |
| CrediCor | base | corporation | **partial** | starting M€ 57 | static:effect — card code 'effect' changes what the card does<br>static:onCardPlayed — card code 'onCardPlayed' changes what the card does<br>static:onStandardProject — card code 'onStandardProject' changes what the card does | — |
| Cupola City | base | automated | **partial** | onPlay:production energy -1<br>onPlay:production megacredits +3 | onPlay:city — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | max oxygen 9 |
| Decomposers | base | active | **partial** | VP 1/3 resources | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does<br>static:onCardPlayed — card code 'onCardPlayed' changes what the card does<br>static:onNonCardTagAdded — card code 'onNonCardTagAdded' changes what the card does | oxygen 3 |
| Deep Well Heating | base | automated | **supported** | onPlay:production energy +1<br>onPlay:temperature +1 step | — | — |
| Deimos Down | base | event | **partial** | onPlay:stock steel +4<br>onPlay:temperature +3 step | onPlay:removeAnyPlants — the target card or player is chosen when played | — |
| Designed Microorganisms | base | automated | **supported** | onPlay:production plants +2 | — | max temperature -14 |
| Domed Crater | base | automated | **partial** | onPlay:production energy -1<br>onPlay:production megacredits +3<br>onPlay:stock plants +3<br>VP 1 | onPlay:city — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | max oxygen 7 |
| Dust Seals | base | automated | **supported** | VP 1 | — | max oceans 3 |
| Ecoline | base | corporation | **partial** | onPlay:production plants +2<br>onPlay:stock plants +3<br>starting M€ 36 | onPlay:greeneryDiscount — greeneries cost fewer plants (not modeled) | — |
| Ecological Zone | base | active | **partial** | VP 1/2 resources | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does<br>static:onCardPlayed — card code 'onCardPlayed' changes what the card does<br>static:onNonCardTagAdded — card code 'onNonCardTagAdded' changes what the card does | 1 greeneries<br>**not evaluated**: card-specific play condition (bespokeCanPlay) |
| Energy Saving | base | automated | **unsupported** | — | onPlay:production.energy — the amount is given by a formula | — |
| Eos Chasma National Park | base | automated | **partial** | onPlay:production megacredits +2<br>onPlay:stock plants +3<br>VP 1 | onPlay:addResourcesToAnyCard — the target card or player is chosen when played | temperature -12 |
| Equatorial Magnetizer | base | active | **supported** | action:production energy -1<br>action:TR +1 | — | — |
| Extreme-Cold Fungus | base | active | **unsupported** | — | action:action — card code 'action' changes what the card does<br>action:canAct — card code 'canAct' changes what the card does | max temperature -10 |
| Farming | base | automated | **supported** | onPlay:production megacredits +2<br>onPlay:production plants +2<br>onPlay:stock plants +2<br>VP 2 | — | temperature 4 |
| Fish | base | active | **partial** | action:+1 resource here<br>VP 1/1 resources | onPlay:decreaseAnyProduction — the target card or player is chosen when played | temperature 2 |
| Flooding | base | event | **partial** | VP -1 | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does | — |
| Food Factory | base | automated | **supported** | onPlay:production megacredits +4<br>onPlay:production plants -1<br>VP 1 | — | — |
| Fueled Generators | base | automated | **supported** | onPlay:production energy +1<br>onPlay:production megacredits -1 | — | — |
| Fusion Power | base | automated | **supported** | onPlay:production energy +3 | — | 2 power |
| Ganymede Colony | base | automated | **partial** | VP 1/1 jovian tags | onPlay:city — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | — |
| Geothermal Power | base | automated | **supported** | onPlay:production energy +2 | — | — |
| GHG Factories | base | automated | **supported** | onPlay:production energy -1<br>onPlay:production heat +4 | — | — |
| GHG Producing Bacteria | base | active | **unsupported** | — | action:or — the player chooses one of several effects | oxygen 4 |
| Giant Ice Asteroid | base | event | **partial** | onPlay:temperature +2 step | onPlay:removeAnyPlants — the target card or player is chosen when played<br>onPlay:ocean — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | — |
| Giant Space Mirror | base | automated | **supported** | onPlay:production energy +3 | — | — |
| Grass | base | automated | **supported** | onPlay:production plants +1<br>onPlay:stock plants +3 | — | temperature -16 |
| Great Dam | base | automated | **supported** | onPlay:production energy +2<br>VP 1 | — | oceans 4 |
| Greenhouses | base | automated | **unsupported** | — | onPlay:stock.plants — the amount is given by a formula | — |
| Heat Trappers | base | automated | **partial** | onPlay:production energy +1<br>VP -1 | onPlay:decreaseAnyProduction — the target card or player is chosen when played | — |
| Heather | base | automated | **supported** | onPlay:production plants +1<br>onPlay:stock plants +1 | — | temperature -14 |
| Helion | base | corporation | **partial** | onPlay:production heat +3<br>starting M€ 42 | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does | — |
| Herbivores | base | active | **partial** | onPlay:+1 resource here<br>VP 1/2 resources | onPlay:decreaseAnyProduction — the target card or player is chosen when played<br>static:onTilePlaced — card code 'onTilePlaced' changes what the card does | oxygen 8 |
| Ice Asteroid | base | event | **unsupported** | — | onPlay:ocean — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | — |
| Ice Cap Melting | base | event | **unsupported** | — | onPlay:ocean — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | temperature 2 |
| Immigrant City | base | active | **unsupported** | — | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does<br>static:onTilePlaced — card code 'onTilePlaced' changes what the card does<br>onPlay:productionBox — card code 'productionBox' changes what the card does | **not evaluated**: card-specific play condition (bespokeCanPlay) |
| Immigration Shuttles | base | automated | **partial** | onPlay:production megacredits +5 | victoryPoints:victoryPoints — victory points depend on cities, all players | — |
| Import of Advanced GHG | base | event | **supported** | onPlay:production heat +2 | — | — |
| Imported GHG | base | event | **supported** | onPlay:production heat +1<br>onPlay:stock heat +3 | — | — |
| Imported Hydrogen | base | event | **unsupported** | — | onPlay:ocean — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled<br>onPlay:bespokePlay — card code 'bespokePlay' changes what the card does | — |
| Imported Nitrogen | base | event | **partial** | onPlay:stock plants +4<br>onPlay:TR +1 | onPlay:addResourcesToAnyCard — the target card or player is chosen when played | — |
| Industrial Microbes | base | automated | **supported** | onPlay:production energy +1<br>onPlay:production steel +1 | — | — |
| Insects | base | automated | **unsupported** | — | onPlay:production.plants — the amount is given by a formula | oxygen 6 |
| Insulation | base | automated | **unsupported** | — | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does | **not evaluated**: card-specific play condition (bespokeCanPlay) |
| Interplanetary Cinematics | base | corporation | **partial** | onPlay:stock steel +20<br>starting M€ 30 | static:onCardPlayed — card code 'onCardPlayed' changes what the card does | — |
| Inventrix | base | corporation | **supported** | firstAction:draw 3<br>starting M€ 45<br>requirement bonus 2 | — | — |
| Ironworks | base | active | **supported** | action:spend energy 4<br>action:stock steel +1<br>action:oxygen +1 step | — | — |
| Kelp Farming | base | automated | **supported** | onPlay:production megacredits +2<br>onPlay:production plants +3<br>onPlay:stock plants +2<br>VP 1 | — | oceans 6 |
| Lake Marineris | base | automated | **partial** | VP 2 | onPlay:ocean — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | temperature 0 |
| Large Convoy | base | event | **partial** | onPlay:draw 2<br>VP 2 | onPlay:ocean — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled<br>onPlay:bespokePlay — card code 'bespokePlay' changes what the card does | — |
| Lava Flows | base | event | **partial** | onPlay:temperature +2 step | onPlay:tile — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | — |
| Lichen | base | automated | **supported** | onPlay:production plants +1 | — | temperature -24 |
| Livestock | base | active | **supported** | onPlay:production plants -1<br>onPlay:production megacredits +2<br>action:+1 resource here<br>VP 1/1 resources | — | oxygen 9 |
| Local Heat Trapping | base | event | **unsupported** | — | static:reserveUnits — resources must remain after paying for the card<br>onPlay:play — card code 'play' changes what the card does | **not evaluated**: card-specific play condition (bespokeCanPlay) |
| Lunar Beam | base | automated | **supported** | onPlay:production megacredits -2<br>onPlay:production heat +2<br>onPlay:production energy +2 | — | — |
| Magnetic Field Dome | base | automated | **supported** | onPlay:production energy -2<br>onPlay:production plants +1<br>onPlay:TR +1 | — | — |
| Magnetic Field Generators | base | automated | **supported** | onPlay:production energy -4<br>onPlay:production plants +2<br>onPlay:TR +3 | — | — |
| Mangrove | base | automated | **partial** | VP 1 | onPlay:greenery — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | temperature 4 |
| Martian Rails | base | active | **partial** | action:spend energy 1 | action:stock.megacredits — the amount is given by a formula | — |
| Methane From Titan | base | automated | **supported** | onPlay:production heat +2<br>onPlay:production plants +2<br>VP 2 | — | oxygen 2 |
| Micro-Mills | base | automated | **supported** | onPlay:production heat +1 | — | — |
| Mining Expedition | base | event | **partial** | onPlay:stock steel +2<br>onPlay:oxygen +1 step | onPlay:removeAnyPlants — the target card or player is chosen when played | — |
| Mining Guild | base | corporation | **partial** | onPlay:production steel +1<br>onPlay:stock steel +5<br>starting M€ 30 | static:onTilePlaced — card code 'onTilePlaced' changes what the card does | — |
| Mining Rights | base | automated | **unsupported** | — | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does<br>onPlay:productionBox — card code 'productionBox' changes what the card does | **not evaluated**: card-specific play condition (bespokeCanPlay) |
| Mohole Area | base | automated | **partial** | onPlay:production heat +4 | onPlay:tile — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | — |
| Moss | base | automated | **partial** | onPlay:production plants +1 | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does | oceans 3<br>**not evaluated**: card-specific play condition (bespokeCanPlay) |
| Natural Preserve | base | automated | **partial** | onPlay:production megacredits +1<br>VP 1 | onPlay:tile — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | max oxygen 4 |
| Nitrite Reducing Bacteria | base | active | **partial** | onPlay:+3 resource here | action:or — the player chooses one of several effects | — |
| Nitrogen-Rich Asteroid | base | event | **partial** | onPlay:temperature +1 step<br>onPlay:TR +2 | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does | — |
| Nitrophilic Moss | base | automated | **partial** | onPlay:production plants +2 | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does | oceans 3<br>**not evaluated**: card-specific play condition (bespokeCanPlay) |
| Noctis City | base | automated | **partial** | onPlay:production megacredits +3 | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does<br>onPlay:productionBox — card code 'productionBox' changes what the card does | **not evaluated**: card-specific play condition (bespokeCanPlay) |
| Noctis Farming | base | automated | **supported** | onPlay:production megacredits +1<br>onPlay:stock plants +2<br>VP 1 | — | temperature -20 |
| Nuclear Power | base | automated | **supported** | onPlay:production energy +3<br>onPlay:production megacredits -2 | — | — |
| Nuclear Zone | base | automated | **partial** | onPlay:temperature +2 step<br>VP -2 | onPlay:tile — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | — |
| Open City | base | automated | **partial** | onPlay:production energy -1<br>onPlay:production megacredits +4<br>onPlay:stock plants +2<br>VP 1 | onPlay:city — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | oxygen 12 |
| Optimal Aerobraking | base | active | **unsupported** | — | static:onCardPlayed — card code 'onCardPlayed' changes what the card does | — |
| Ore Processor | base | active | **supported** | action:spend energy 4<br>action:stock titanium +1<br>action:oxygen +1 step | — | — |
| Permafrost Extraction | base | event | **unsupported** | — | onPlay:ocean — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | temperature -8 |
| Peroxide Power | base | automated | **supported** | onPlay:production energy +2<br>onPlay:production megacredits -1 | — | — |
| Pets | base | active | **partial** | onPlay:+1 resource here<br>VP 1/2 resources | static:protectedResources — resources on this card cannot be removed by others<br>static:onTilePlaced — card code 'onTilePlaced' changes what the card does | — |
| PhoboLog | base | corporation | **supported** | onPlay:stock titanium +10<br>titanium value +1<br>starting M€ 23 | — | — |
| Phobos Space Haven | base | automated | **partial** | onPlay:production titanium +1<br>VP 3 | onPlay:city — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | — |
| Plantation | base | automated | **unsupported** | — | onPlay:greenery — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | 2 science |
| Power Grid | base | automated | **unsupported** | — | onPlay:production.energy — the amount is given by a formula | — |
| Power Plant | base | automated | **supported** | onPlay:production energy +1 | — | — |
| Predators | base | active | **partial** | action:+1 resource here<br>VP 1/1 resources | action:removeResourcesFromAnyCard — the target card or player is chosen when played | oxygen 11 |
| Protected Valley | base | automated | **partial** | onPlay:production megacredits +2 | onPlay:greenery — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | — |
| Rad-Chem Factory | base | automated | **supported** | onPlay:production energy -1<br>onPlay:TR +2 | — | — |
| Regolith Eaters | base | active | **unsupported** | — | action:or — the player chooses one of several effects | — |
| Release of Inert Gases | base | event | **supported** | onPlay:TR +2 | — | — |
| Research Outpost | base | active | **partial** | discount 1 all | onPlay:city — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | — |
| Rover Construction | base | active | **partial** | VP 1 | static:onTilePlaced — card code 'onTilePlaced' changes what the card does | — |
| Search For Life | base | active | **unsupported** | — | victoryPoints:victoryPoints — victory points are computed by card code<br>action:action — card code 'action' changes what the card does<br>action:canAct — card code 'canAct' changes what the card does<br>static:getVictoryPoints — card code 'getVictoryPoints' changes what the card does | max oxygen 6 |
| Shuttles | base | active | **supported** | onPlay:production energy -1<br>onPlay:production megacredits +2<br>VP 1<br>discount 2 space | — | oxygen 5 |
| Small Animals | base | active | **partial** | action:+1 resource here<br>VP 1/2 resources | onPlay:decreaseAnyProduction — the target card or player is chosen when played | oxygen 6 |
| Soil Factory | base | automated | **supported** | onPlay:production energy -1<br>onPlay:production plants +1<br>VP 1 | — | — |
| Solar Power | base | automated | **supported** | onPlay:production energy +1<br>VP 1 | — | — |
| Solar Wind Power | base | automated | **supported** | onPlay:production energy +1<br>onPlay:stock titanium +2 | — | — |
| Soletta | base | automated | **supported** | onPlay:production heat +7 | — | — |
| Space Mirrors | base | active | **supported** | action:spend megacredits 7<br>action:production energy +1 | — | — |
| Special Design | base | event | **supported** | requirement bonus 2 (next card) | — | — |
| Steelworks | base | active | **supported** | action:spend energy 4<br>action:stock steel +2<br>action:oxygen +1 step | — | — |
| Strip Mine | base | automated | **supported** | onPlay:production energy -2<br>onPlay:production steel +2<br>onPlay:production titanium +1<br>onPlay:oxygen +2 step | — | — |
| Subterranean Reservoir | base | event | **unsupported** | — | onPlay:ocean — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | — |
| Symbiotic Fungus | base | active | **unsupported** | — | action:addResourcesToAnyCard — the target card or player is chosen when played | temperature -14 |
| Tectonic Stress Power | base | automated | **supported** | onPlay:production energy +3<br>VP 1 | — | 2 science |
| Tharsis Republic | base | corporation | **partial** | starting M€ 40 | firstAction:city — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled<br>onPlay:bespokePlay — card code 'bespokePlay' changes what the card does<br>static:onTilePlaced — card code 'onTilePlaced' changes what the card does | — |
| ThorGate | base | corporation | **partial** | onPlay:production energy +1<br>starting M€ 48<br>discount 3 power | static:getStandardProjectDiscount — card code 'getStandardProjectDiscount' changes what the card does | — |
| Towing A Comet | base | event | **partial** | onPlay:stock plants +2<br>onPlay:oxygen +1 step | onPlay:ocean — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | — |
| Trees | base | automated | **supported** | onPlay:production plants +3<br>onPlay:stock plants +1<br>VP 1 | — | temperature -4 |
| Tundra Farming | base | automated | **supported** | onPlay:production plants +1<br>onPlay:production megacredits +2<br>onPlay:stock plants +1<br>VP 2 | — | temperature -6 |
| Underground City | base | automated | **partial** | onPlay:production energy -2<br>onPlay:production steel +2 | onPlay:city — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | — |
| Underground Detonations | base | active | **supported** | action:spend megacredits 10<br>action:production heat +2 | — | — |
| United Nations Mars Initiative | base | corporation | **partial** | starting M€ 40 | action:action — card code 'action' changes what the card does<br>action:canAct — card code 'canAct' changes what the card does | — |
| Urbanized Area | base | automated | **partial** | onPlay:production megacredits +2 | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does<br>onPlay:productionBox — card code 'productionBox' changes what the card does | **not evaluated**: card-specific play condition (bespokeCanPlay) |
| Water Import From Europa | base | active | **partial** | action:spend megacredits 12<br>VP 1/1 jovian tags | action:spend.canUseTitanium — the cost may be paid with steel or titanium instead<br>action:ocean — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | — |
| Water Splitting Plant | base | active | **partial** | action:spend energy 3<br>action:oxygen +1 step | action:bespokeCanAct — card code 'bespokeCanAct' changes what the card does | oceans 2 |
| Wave Power | base | automated | **supported** | onPlay:production energy +1<br>VP 1 | — | oceans 3 |
| Windmills | base | automated | **supported** | onPlay:production energy +1<br>VP 1 | — | oxygen 7 |
| Worms | base | automated | **unsupported** | — | onPlay:production.plants — the amount is given by a formula | oxygen 4 |
| Zeppelins | base | automated | **partial** | VP 1 | onPlay:production.megacredits — the amount is given by a formula | oxygen 5 |
| Acquired Company | corpera | automated | **supported** | onPlay:production megacredits +3 | — | — |
| Advanced Alloys | corpera | active | **supported** | steel value +1<br>titanium value +1 | — | — |
| AI Central | corpera | active | **supported** | onPlay:production energy -1<br>action:draw 2<br>VP 1 | — | 3 science |
| Anti-Gravity Technology | corpera | active | **supported** | VP 3<br>discount 2 all | — | 7 science |
| Asteroid Mining Consortium | corpera | automated | **partial** | VP 1 | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does | titanium production 1<br>**not evaluated**: card-specific play condition (bespokeCanPlay) |
| Bribed Committee | corpera | event | **supported** | onPlay:TR +2<br>VP -2 | — | — |
| Building Industries | corpera | automated | **supported** | onPlay:production energy -1<br>onPlay:production steel +2 | — | — |
| Business Contacts | corpera | event | **unsupported** | — | onPlay:drawCard — some drawn cards are discarded | — |
| Business Network | corpera | active | **partial** | onPlay:production megacredits -1 | action:drawCard — drawn cards are kept only if paid for | — |
| Callisto Penal Mines | corpera | automated | **supported** | onPlay:production megacredits +3<br>VP 2 | — | — |
| Caretaker Contract | corpera | active | **supported** | action:spend heat 8<br>action:TR +1 | — | temperature 0 |
| Cartel | corpera | automated | **unsupported** | — | onPlay:production.megacredits — the amount is given by a formula | — |
| CEO's Favorite Project | corpera | event | **unsupported** | — | onPlay:addResourcesToAnyCard — the target card or player is chosen when played | — |
| Commercial District | corpera | automated | **partial** | onPlay:production energy -1<br>onPlay:production megacredits +4 | onPlay:tile — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled<br>victoryPoints:victoryPoints — victory points depend on cities, nextToThis | — |
| Corporate Stronghold | corpera | automated | **partial** | onPlay:production energy -1<br>onPlay:production megacredits +3<br>VP -2 | onPlay:city — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | — |
| Development Center | corpera | active | **supported** | action:spend energy 1<br>action:draw 1 | — | — |
| Earth Catapult | corpera | active | **supported** | VP 2<br>discount 2 all | — | — |
| Earth Office | corpera | active | **supported** | discount 3 earth | — | — |
| Electro Catapult | corpera | active | **partial** | onPlay:production energy -1<br>VP 1 | action:or — the player chooses one of several effects | max oxygen 8 |
| Energy Tapping | corpera | automated | **partial** | VP -1 | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does | — |
| Fuel Factory | corpera | automated | **supported** | onPlay:production energy -1<br>onPlay:production megacredits +1<br>onPlay:production titanium +1 | — | — |
| Gene Repair | corpera | automated | **supported** | onPlay:production megacredits +2<br>VP 2 | — | 3 science |
| Great Escarpment Consortium | corpera | automated | **unsupported** | — | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does | steel production 1 |
| Hackers | corpera | automated | **partial** | onPlay:production energy -1<br>onPlay:production megacredits +2<br>VP -1 | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does | — |
| Hired Raiders | corpera | event | **unsupported** | — | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does | — |
| Indentured Workers | corpera | event | **partial** | VP -1 | static:getCardDiscount — card code 'getCardDiscount' changes what the card does | — |
| Industrial Center | corpera | active | **partial** | action:spend megacredits 7<br>action:production steel +1 | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does | **not evaluated**: card-specific play condition (bespokeCanPlay) |
| Interstellar Colony Ship | corpera | event | **supported** | VP 4 | — | 5 science |
| Invention Contest | corpera | event | **unsupported** | — | onPlay:drawCard — some drawn cards are discarded | — |
| Inventors' Guild | corpera | active | **unsupported** | — | action:drawCard — drawn cards are kept only if paid for | — |
| Investment Loan | corpera | event | **supported** | onPlay:production megacredits -1<br>onPlay:stock megacredits +10 | — | — |
| Io Mining Industries | corpera | automated | **supported** | onPlay:production titanium +2<br>onPlay:production megacredits +2<br>VP 1/1 jovian tags | — | — |
| Lagrange Observatory | corpera | automated | **supported** | onPlay:draw 1<br>VP 1 | — | — |
| Land Claim | corpera | event | **unsupported** | — | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does | **not evaluated**: card-specific play condition (bespokeCanPlay) |
| Lightning Harvest | corpera | automated | **supported** | onPlay:production energy +1<br>onPlay:production megacredits +1<br>VP 1 | — | 3 science |
| Mars University | corpera | active | **partial** | VP 1 | static:onCardPlayed — card code 'onCardPlayed' changes what the card does<br>static:onNonCardTagAdded — card code 'onNonCardTagAdded' changes what the card does<br>static:onScienceTagAdded — card code 'onScienceTagAdded' changes what the card does | — |
| Mass Converter | corpera | active | **supported** | onPlay:production energy +6<br>discount 2 space (per card) | — | 5 science |
| Media Archives | corpera | automated | **unsupported** | — | onPlay:stock.megacredits — the amount is given by a formula | — |
| Media Group | corpera | active | **unsupported** | — | static:onCardPlayed — card code 'onCardPlayed' changes what the card does | — |
| Medical Lab | corpera | automated | **partial** | VP 1 | onPlay:production.megacredits — the amount is given by a formula | — |
| Mine | corpera | automated | **supported** | onPlay:production steel +1 | — | — |
| Mineral Deposit | corpera | event | **supported** | onPlay:stock steel +5 | — | — |
| Mining Area | corpera | automated | **unsupported** | — | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does<br>onPlay:productionBox — card code 'productionBox' changes what the card does | **not evaluated**: card-specific play condition (bespokeCanPlay) |
| Miranda Resort | corpera | automated | **partial** | VP 1 | onPlay:production.megacredits — the amount is given by a formula | — |
| Olympus Conference | corpera | active | **partial** | VP 1 | static:onCardPlayed — card code 'onCardPlayed' changes what the card does<br>static:onNonCardTagAdded — card code 'onNonCardTagAdded' changes what the card does<br>static:onScienceTagAdded — card code 'onScienceTagAdded' changes what the card does | — |
| Physics Complex | corpera | active | **supported** | action:spend energy 6<br>action:+1 resource here<br>VP 2/1 resources | — | — |
| Power Infrastructure | corpera | active | **unsupported** | — | action:action — card code 'action' changes what the card does<br>action:canAct — card code 'canAct' changes what the card does | — |
| Power Supply Consortium | corpera | automated | **unsupported** | — | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does | 2 power |
| Protected Habitats | corpera | active | **none** | — | — | — |
| Quantum Extractor | corpera | active | **supported** | onPlay:production energy +4<br>discount 2 space | — | 4 science |
| Rad-Suits | corpera | automated | **supported** | onPlay:production megacredits +1<br>VP 1 | — | 2 cities (all players) |
| Research | corpera | automated | **supported** | onPlay:draw 2<br>VP 1 | — | — |
| Restricted Area | corpera | active | **partial** | action:spend megacredits 2<br>action:draw 1 | onPlay:tile — a tile is placed: space, bonuses and the global parameter / TR it raises are not modeled | — |
| Robotic Workforce | corpera | automated | **unsupported** | — | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does<br>static:getPlayableBuildingCards — card code 'getPlayableBuildingCards' changes what the card does<br>static:isCardApplicable — card code 'isCardApplicable' changes what the card does<br>onPlay:productionBehavior — card code 'productionBehavior' changes what the card does<br>static:selectBuildingCard — card code 'selectBuildingCard' changes what the card does | **not evaluated**: card-specific play condition (bespokeCanPlay) |
| Sabotage | corpera | event | **unsupported** | — | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does | — |
| Satellites | corpera | automated | **unsupported** | — | onPlay:production.megacredits — the amount is given by a formula | — |
| Saturn Systems | corpera | corporation | **partial** | onPlay:production titanium +1<br>starting M€ 42 | static:onCardPlayedByAnyPlayer — card code 'onCardPlayedByAnyPlayer' changes what the card does<br>static:onNonCardTagAddedByAnyPlayer — card code 'onNonCardTagAddedByAnyPlayer' changes what the card does | — |
| Security Fleet | corpera | active | **supported** | action:spend titanium 1<br>action:+1 resource here<br>VP 1/1 resources | — | — |
| Space Elevator | corpera | active | **supported** | onPlay:production titanium +1<br>action:spend steel 1<br>action:stock megacredits +5<br>VP 2 | — | — |
| Space Station | corpera | active | **supported** | VP 1<br>discount 2 space | — | — |
| Sponsors | corpera | automated | **supported** | onPlay:production megacredits +2 | — | — |
| Standard Technology | corpera | active | **unsupported** | — | static:onStandardProject — card code 'onStandardProject' changes what the card does | — |
| Tardigrades | corpera | active | **supported** | action:+1 resource here<br>VP 1/4 resources | — | — |
| Technology Demonstration | corpera | event | **supported** | onPlay:draw 2 | — | — |
| Teractor | corpera | corporation | **supported** | starting M€ 60<br>discount 3 earth | — | — |
| Terraforming Ganymede | corpera | automated | **partial** | VP 2 | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does<br>static:computeTr — card code 'computeTr' changes what the card does | — |
| Titanium Mine | corpera | automated | **supported** | onPlay:production titanium +1 | — | — |
| Toll Station | corpera | automated | **unsupported** | — | onPlay:production.megacredits — the amount is given by a formula | — |
| Trans-Neptune Probe | corpera | automated | **supported** | VP 1 | — | — |
| Tropical Resort | corpera | automated | **supported** | onPlay:production megacredits +3<br>onPlay:production heat -2<br>VP 2 | — | — |
| Vesta Shipyard | corpera | automated | **supported** | onPlay:production titanium +1<br>VP 1 | — | — |
| Viral Enhancers | corpera | active | **unsupported** | — | static:addPlant — card code 'addPlant' changes what the card does<br>static:onCardPlayed — card code 'onCardPlayed' changes what the card does<br>static:onNonCardTagAdded — card code 'onNonCardTagAdded' changes what the card does | — |
| Virus | corpera | event | **unsupported** | — | onPlay:bespokePlay — card code 'bespokePlay' changes what the card does | — |
