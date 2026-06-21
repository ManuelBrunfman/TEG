export interface TerritorySprite {
  id: number;
  file: string;
  x: number;
  y: number;
  width: number;
  height: number;
  markerX: number;
  markerY: number;
}

const RAW_TERRITORY_SPRITES: TerritorySprite[] = [
  { id: 0, file: "America_del_Sur_Argentina.png", x: 260, y: 355, width: 57, height: 100, markerX: 260, markerY: 383 },
  { id: 1, file: "America_del_Sur_Brasil.png", x: 286, y: 280, width: 106, height: 87, markerX: 294, markerY: 306 },
  { id: 2, file: "America_del_Sur_Chile.png", x: 252, y: 355, width: 24, height: 94, markerX: 244, markerY: 363 },
  { id: 3, file: "America_del_Sur_Colombia.png", x: 230, y: 274, width: 73, height: 52, markerX: 242, markerY: 284 },
  { id: 4, file: "America_del_Sur_Peru.png", x: 240, y: 314, width: 65, height: 49, markerX: 260, markerY: 324 },
  { id: 5, file: "America_del_Sur_Uruguay.png", x: 305, y: 355, width: 51, height: 48, markerX: 299, markerY: 335 },
  { id: 6, file: "America_del_Norte_Mexico.png", x: 135, y: 222, width: 102, height: 74, markerX: 151, markerY: 238 },
  { id: 7, file: "America_del_Norte_California.png", x: 79, y: 192, width: 122, height: 94, markerX: 59, markerY: 162 },
  { id: 8, file: "America_del_Norte_Orgeon.png", x: 15, y: 163, width: 133, height: 102, markerX: 18, markerY: 181 },
  { id: 9, file: "America_del_Norte_Nueva_York.png", x: 125, y: 123, width: 122, height: 95, markerX: 55, markerY: 113 },
  { id: 10, file: "America_del_Norte_Alaska.png", x: 5, y: 117, width: 52, height: 112, markerX: 18, markerY: 137 },
  { id: 11, file: "America_del_Norte_Yukon.png", x: 38, y: 75, width: 79, height: 112, markerX: 28, markerY: 75 },
  { id: 12, file: "America_del_Norte_Canada.png", x: 89, y: 26, width: 110, height: 140, markerX: 84, markerY: 39 },
  { id: 13, file: "America_del_Norte_Terranova.png", x: 151, y: 107, width: 96, height: 76, markerX: 123, markerY: 107 },
  { id: 14, file: "America_del_Norte_Labrador.png", x: 198, y: 96, width: 57, height: 55, markerX: 180, markerY: 88 },
  { id: 15, file: "America_del_Norte_Groenlandia.png", x: 231, y: 29, width: 106, height: 122, markerX: 251, markerY: 29 },
  { id: 16, file: "Africa_Sahara.png", x: 484, y: 327, width: 100, height: 84, markerX: 504, markerY: 347 },
  { id: 17, file: "Africa_Zaire.png", x: 528, y: 376, width: 84, height: 61, markerX: 542, markerY: 386 },
  { id: 18, file: "Africa_Etiopia.png", x: 561, y: 353, width: 101, height: 51, markerX: 565, markerY: 353 },
  { id: 19, file: "Africa_Egipto.png", x: 565, y: 319, width: 125, height: 62, markerX: 585, markerY: 319 },
  { id: 20, file: "Africa_Madagascar.png", x: 671, y: 372, width: 49, height: 82, markerX: 686, markerY: 389 },
  { id: 21, file: "Africa_Sudafrica.png", x: 587, y: 399, width: 66, height: 71, markerX: 595, markerY: 413 },
  { id: 22, file: "Oceania_Australia.png", x: 772, y: 340, width: 84, height: 89, markerX: 802, markerY: 365 },
  { id: 23, file: "Oceania_Borneo.png", x: 787, y: 274, width: 32, height: 56, markerX: 793, markerY: 290 },
  { id: 24, file: "Oceania_Java.png", x: 823, y: 274, width: 29, height: 57, markerX: 836, markerY: 295 },
  { id: 25, file: "Oceania_Sumatra.png", x: 728, y: 317, width: 43, height: 49, markerX: 738, markerY: 329 },
  { id: 26, file: "Europe_Espania.png", x: 421, y: 257, width: 68, height: 66, markerX: 440, markerY: 278 },
  { id: 27, file: "Europe_Francia.png", x: 471, y: 202, width: 72, height: 86, markerX: 485, markerY: 228 },
  { id: 28, file: "Europe_Alemania.png", x: 528, y: 181, width: 72, height: 93, markerX: 548, markerY: 211 },
  { id: 29, file: "Europe_Italia.png", x: 532, y: 251, width: 71, height: 77, markerX: 551, markerY: 276 },
  { id: 30, file: "Europe_Polonia.png", x: 550, y: 173, width: 89, height: 92, markerX: 590, markerY: 213 },
  { id: 31, file: "Europe_Rusia.png", x: 554, y: 61, width: 129, height: 171, markerX: 603, markerY: 111 },
  { id: 32, file: "Europe_Suecia.png", x: 499, y: 72, width: 65, height: 68, markerX: 519, markerY: 102 },
  { id: 33, file: "Europe_Gran_Bretana.png", x: 436, y: 148, width: 60, height: 77, markerX: 456, markerY: 178 },
  { id: 34, file: "Europe_Islandia.png", x: 346, y: 136, width: 64, height: 79, markerX: 366, markerY: 166 },
  { id: 35, file: "Asia_Arabia.png", x: 652, y: 259, width: 69, height: 60, markerX: 676, markerY: 289 },
  { id: 36, file: "Asia_Israel.png", x: 627, y: 249, width: 69, height: 54, markerX: 647, markerY: 269 },
  { id: 37, file: "Asia_Turquia.png", x: 608, y: 211, width: 113, height: 60, markerX: 638, markerY: 236 },
  { id: 38, file: "Asia_India.png", x: 731, y: 227, width: 64, height: 88, markerX: 757, markerY: 257 },
  { id: 39, file: "Asia_Malasia.png", x: 786, y: 200, width: 61, height: 74, markerX: 812, markerY: 230 },
  { id: 40, file: "Asia_Iran.png", x: 644, y: 122, width: 92, height: 128, markerX: 680, markerY: 168 },
  { id: 41, file: "Asia_Gobi.png", x: 696, y: 143, width: 59, height: 81, markerX: 718, markerY: 177 },
  { id: 42, file: "Asia_China.png", x: 721, y: 90, width: 129, height: 144, markerX: 781, markerY: 140 },
  { id: 43, file: "Asia_Mongolia.png", x: 656, y: 107, width: 83, height: 69, markerX: 680, markerY: 131 },
  { id: 44, file: "Asia_Siberia.png", x: 653, y: 56, width: 94, height: 65, markerX: 693, markerY: 80 },
  { id: 45, file: "Asia_Aral.png", x: 612, y: 51, width: 45, height: 77, markerX: 627, markerY: 75 },
  { id: 46, file: "Asia_Tartaria.png", x: 633, y: 29, width: 50, height: 71, markerX: 648, markerY: 49 },
  { id: 47, file: "Asia_Tamyr.png", x: 671, y: 40, width: 47, height: 55, markerX: 691, markerY: 56 },
  { id: 48, file: "Asia_Kamtchatka.png", x: 724, y: 44, width: 59, height: 49, markerX: 744, markerY: 60 },
  { id: 49, file: "Asia_Japon.png", x: 793, y: 75, width: 60, height: 54, markerX: 813, markerY: 95 }
];

const CORRECT_ARMY_MARKERS: Array<[number, number]> = [
  [288.5, 419], [343, 336.5], [260, 406], [272.5, 305], [282.5, 343.5], [327.5, 369],
  [194, 267], [130, 224], [76.5, 222], [151, 165.5], [36, 183], [72.5, 131], [132, 86],
  [185, 145], [217.5, 119.5], [294, 90], [534, 369], [577, 411.5], [613.5, 368.5],
  [637.5, 337.5], [685.5, 408], [624, 441.5], [829, 372], [796, 302], [840.5, 294.5],
  [754.5, 337.5], [445, 288], [514, 238], [564, 227.5], [561.5, 284.5], [604.5, 229],
  [615.5, 156.5], [531.5, 116], [476, 181.5], [378, 170.5], [693.5, 299],
  [656.5, 281], [669.5, 228.5], [766, 271], [819.5, 242], [683, 174], [724.5, 190.5],
  [780.5, 162], [699.5, 148.5], [710, 95.5], [634.5, 83.5], [654, 60.5], [694.5, 61.5],
  [753.5, 58.5], [818, 112]
];

export const TERRITORY_SPRITES: TerritorySprite[] = RAW_TERRITORY_SPRITES.map((sprite) => ({
  ...sprite,
  markerX: CORRECT_ARMY_MARKERS[sprite.id][0],
  markerY: CORRECT_ARMY_MARKERS[sprite.id][1]
}));

export const TERRITORY_SPRITE_BY_ID = Object.fromEntries(
  TERRITORY_SPRITES.map((sprite) => [sprite.id, sprite])
) as Record<number, TerritorySprite>;
