import type { CardSymbol, ContinentId, CountryDefinition, PlayerColor } from "./types.js";

export const PLAYER_COLORS: PlayerColor[] = ["azul", "rojo", "negro", "amarillo", "verde", "magenta"];

export const COLOR_HEX: Record<PlayerColor, string> = {
  azul: "#3f75b5",
  rojo: "#a13c35",
  negro: "#373536",
  amarillo: "#d3a83d",
  verde: "#4d7c4a",
  magenta: "#9d4f87"
};

export const CONTINENTS: Record<ContinentId, { name: string; bonus: number; tint: string }> = {
  "america-sur": { name: "América del Sur", bonus: 3, tint: "#75945e" },
  "america-norte": { name: "América del Norte", bonus: 5, tint: "#7893a3" },
  africa: { name: "África", bonus: 3, tint: "#b28a51" },
  oceania: { name: "Oceanía", bonus: 2, tint: "#8d6b9b" },
  europa: { name: "Europa", bonus: 5, tint: "#9c765c" },
  asia: { name: "Asia", bonus: 7, tint: "#a08d58" }
};

const c = (
  id: number,
  name: string,
  continent: ContinentId,
  symbol: CardSymbol,
  x: number,
  y: number
): CountryDefinition => ({ id, name, continent, symbol, x, y });

export const COUNTRIES: CountryDefinition[] = [
  c(0, "Argentina", "america-sur", "comodín", 310, 535),
  c(1, "Brasil", "america-sur", "galeón", 350, 450),
  c(2, "Chile", "america-sur", "globo", 275, 510),
  c(3, "Colombia", "america-sur", "globo", 285, 385),
  c(4, "Perú", "america-sur", "galeón", 285, 440),
  c(5, "Uruguay", "america-sur", "globo", 355, 515),
  c(6, "México", "america-norte", "cañón", 205, 335),
  c(7, "California", "america-norte", "cañón", 145, 285),
  c(8, "Oregón", "america-norte", "cañón", 125, 225),
  c(9, "Nueva York", "america-norte", "galeón", 270, 255),
  c(10, "Alaska", "america-norte", "galeón", 55, 120),
  c(11, "Yukón", "america-norte", "globo", 115, 145),
  c(12, "Canadá", "america-norte", "cañón", 205, 175),
  c(13, "Terranova", "america-norte", "cañón", 295, 195),
  c(14, "Labrador", "america-norte", "cañón", 350, 160),
  c(15, "Groenlandia", "america-norte", "galeón", 405, 95),
  c(16, "Sahara", "africa", "cañón", 485, 370),
  c(17, "Zaire", "africa", "galeón", 535, 445),
  c(18, "Etiopía", "africa", "globo", 585, 405),
  c(19, "Egipto", "africa", "globo", 560, 345),
  c(20, "Madagascar", "africa", "galeón", 640, 485),
  c(21, "Sudáfrica", "africa", "cañón", 545, 515),
  c(22, "Australia", "oceania", "cañón", 850, 520),
  c(23, "Borneo", "oceania", "galeón", 825, 430),
  c(24, "Java", "oceania", "cañón", 885, 455),
  c(25, "Sumatra", "oceania", "globo", 775, 475),
  c(26, "España", "europa", "globo", 455, 300),
  c(27, "Francia", "europa", "globo", 490, 250),
  c(28, "Alemania", "europa", "galeón", 535, 220),
  c(29, "Italia", "europa", "globo", 535, 280),
  c(30, "Polonia", "europa", "cañón", 585, 220),
  c(31, "Rusia", "europa", "globo", 635, 155),
  c(32, "Suecia", "europa", "galeón", 545, 125),
  c(33, "Gran Bretaña", "europa", "galeón", 450, 205),
  c(34, "Islandia", "europa", "galeón", 455, 125),
  c(35, "Arabia", "asia", "cañón", 650, 340),
  c(36, "Israel", "asia", "galeón", 615, 315),
  c(37, "Turquía", "asia", "galeón", 640, 260),
  c(38, "India", "asia", "globo", 760, 360),
  c(39, "Malasia", "asia", "cañón", 815, 385),
  c(40, "Irán", "asia", "globo", 700, 275),
  c(41, "Gobi", "asia", "globo", 790, 260),
  c(42, "China", "asia", "galeón", 825, 315),
  c(43, "Mongolia", "asia", "galeón", 800, 205),
  c(44, "Siberia", "asia", "galeón", 800, 135),
  c(45, "Aral", "asia", "cañón", 700, 190),
  c(46, "Tartaria", "asia", "cañón", 745, 120),
  c(47, "Taimir", "asia", "comodín", 750, 65),
  c(48, "Kamchatka", "asia", "globo", 910, 125),
  c(49, "Japón", "asia", "cañón", 915, 250)
];

export const BORDER_PAIRS: Array<[number, number]> = [
  [0, 1], [0, 2], [0, 4], [0, 5], [1, 3], [1, 4], [1, 5], [1, 16],
  [2, 4], [2, 22], [3, 4], [3, 6], [6, 7], [7, 8], [7, 9], [8, 9],
  [8, 10], [8, 11], [8, 12], [9, 12], [9, 13], [9, 15], [10, 11], [10, 48],
  [11, 12], [12, 13], [13, 14], [14, 15], [15, 34], [16, 17], [16, 18],
  [16, 19], [16, 26], [17, 18], [17, 20], [17, 21], [18, 19], [18, 21],
  [19, 20], [19, 30], [19, 36], [19, 37], [22, 23], [22, 24], [22, 25],
  [23, 39], [25, 38], [26, 27], [26, 33], [27, 28], [27, 29], [28, 29],
  [28, 30], [28, 33], [30, 31], [30, 37], [31, 32], [31, 37], [31, 40],
  [31, 45], [32, 34], [33, 34], [35, 36], [35, 37], [36, 37], [37, 40],
  [38, 39], [38, 40], [38, 42], [39, 42], [40, 41], [40, 42], [40, 43],
  [40, 45], [41, 42], [41, 43], [42, 43], [42, 44], [42, 48], [42, 49],
  [43, 44], [43, 45], [44, 45], [44, 46], [44, 47], [44, 48], [45, 46],
  [46, 47], [48, 49]
];

export const ADJACENCY = BORDER_PAIRS.reduce<Record<number, number[]>>((map, [a, b]) => {
  (map[a] ??= []).push(b);
  (map[b] ??= []).push(a);
  return map;
}, {});

export const areAdjacent = (a: number, b: number) => ADJACENCY[a]?.includes(b) ?? false;
