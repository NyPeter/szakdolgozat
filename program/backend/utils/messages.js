// Every message the server sends to the client, in one place.
// Style: Hungarian, informal ("te") form, full sentences ending with a period,
// and the same game term for the same thing everywhere
// (lerakás, szúrás, handolás, cserelap, dzsóker).

const messages = {
  // ── General ─────────────────────────────────────────────────────────────
  SERVER_ERROR: 'Szerverhiba történt, próbáld újra.',
  INVALID_REQUEST: 'Érvénytelen kérés.',
  NOT_FOUND: 'A kért oldal nem található.',
  UNAUTHORIZED: 'Be kell jelentkezned.',
  FORBIDDEN: 'Ehhez nincs jogosultságod.',

  // ── Account ─────────────────────────────────────────────────────────────
  LOGIN_FIELDS_REQUIRED: 'Add meg az email címet és a jelszót.',
  REGISTER_FIELDS_REQUIRED: 'Add meg a nevet, az email címet és a jelszót.',
  EMAIL_NOT_FOUND: 'Ezzel az email címmel nincs regisztrált felhasználó.',
  ACCOUNT_SUSPENDED: (until) => `A fiókod ${new Date(until).toLocaleDateString('hu-HU')}-ig fel van függesztve.`,
  WRONG_PASSWORD: 'Hibás jelszó.',
  USER_NOT_FOUND: 'A felhasználó nem található.',
  EMAIL_TAKEN: 'Ezzel az email címmel már regisztráltak.',
  NAME_TAKEN: 'Ez a felhasználónév már foglalt.',
  INVALID_EMAIL: 'Érvénytelen email cím.',
  PASSWORD_TOO_SHORT: 'A jelszónak legalább 8 karakter hosszúnak kell lennie.',
  INVALID_DATA: 'Érvénytelen adatok.',
  PASSWORDS_REQUIRED: 'Add meg a jelenlegi és az új jelszót is.',
  WRONG_CURRENT_PASSWORD: 'A jelenlegi jelszó helytelen.',
  PASSWORD_CHANGED: 'A jelszó megváltozott.',
  DELETE_FAILED: 'A fiók törlése nem sikerült.',
  NO_FILE: 'Nem választottál ki fájlt.',
  FILE_TOO_LARGE: 'A kép mérete legfeljebb 5 MB lehet.',
  INVALID_FILE_TYPE: 'Csak PNG vagy JPG kép tölthető fel.',
  UPLOAD_FAILED: 'A kép feltöltése nem sikerült.',
  CANNOT_MODIFY_ADMIN: 'Adminisztrátort nem lehet felfüggeszteni vagy elnémítani.',

  // ── Rooms ───────────────────────────────────────────────────────────────
  ACTIVE_GAME: 'Folyamatban lévő játékod van. Előbb fejezd be vagy add fel.',
  NOT_IN_ROOM: 'Nem vagy szobában.',
  ROOM_NOT_FOUND: 'A szoba nem található.',
  ROOM_CREATE_IN_PROGRESS: 'A szoba létrehozása már folyamatban van.',
  ROOM_ALREADY_OPEN: 'Már van egy nyitott szobád.',
  ROOM_FULL: 'A szoba megtelt.',
  GAME_FINISHED: 'Ez a játék már véget ért.',
  GAME_ALREADY_STARTED: 'A játék már elindult.',
  OWNER_ONLY_SETTINGS: 'Csak a szoba tulajdonosa módosíthatja a beállításokat.',
  OWNER_ONLY_KICK: 'Csak a szoba tulajdonosa távolíthat el játékost.',
  OWNER_ONLY_START: 'Csak a szoba tulajdonosa indíthatja el a játékot.',
  MAX_PLAYERS_TOO_LOW: (count) => `A létszám nem lehet kevesebb a szobában lévő játékosok számánál (${count}).`,
  CANNOT_KICK_SELF: 'Saját magadat nem távolíthatod el.',
  NOT_ENOUGH_PLAYERS: 'A játékhoz legalább 2 játékos kell.',

  // ── Chat ────────────────────────────────────────────────────────────────
  INVALID_CHAT_MESSAGE: 'Az üzenet nem lehet üres vagy 500 karakternél hosszabb.',
  MUTED: 'Le vagy némítva.',

  // ── Game ────────────────────────────────────────────────────────────────
  GAME_NOT_STARTED: 'A játék még nem indult el.',
  NOT_YOUR_TURN: 'Nem te következel.',
  ALREADY_DRAWN: 'Ebben a körben már húztál.',
  MUST_DRAW_FIRST: 'Előbb húznod kell egy lapot.',
  DECK_EMPTY: 'Nincs több lap a pakliban.',
  DISCARD_PILE_EMPTY: 'A dobóhalom üres.',
  INVALID_DRAW_SOURCE: 'Innen nem lehet lapot húzni.',
  NO_CSERELAP: 'Nincs cserelap az asztalon.',
  CSERELAP_AFTER_FIRST_MELD: 'Az első lerakásod után a cserelapot már nem használhatod.',
  CARD_NOT_IN_HAND: 'Ez a lap nincs a kezedben.',
  DISCARD_TAKEN_CARD: 'A dobóhalomból felvett lapot nem dobhatod el rögtön.',
  USE_TAKEN_CARD_FIRST: 'Előbb használd fel a dobóhalomból felvett lapot.',
  USE_JOKER_FIRST: 'Előbb használd fel a kicserélt dzsókert.',
  FINISH_CSERELAP_HANDOLAS: 'Cserelapot húztál: fejezd be a handolást, vagy vond vissza a húzást.',
  FINISH_HANDOLAS_BID: 'Handolást jeleztél: fejezd be, vagy vond vissza a jelzést.',
  NO_CARDS_SELECTED: 'Nem jelöltél ki lerakandó lapokat.',
  MELD_TOO_SHORT: 'Minden csoporthoz legalább 3 lap kell.',
  CARD_IN_TWO_GROUPS: 'Ugyanazt a lapot több csoportban is használtad.',
  INVALID_MELD: 'Érvénytelen lerakás.',
  FIRST_MELD_MINIMUM: (total) => `Az első lerakásnak legalább 51 pontot kell érnie (a tiéd: ${total}).`,
  KEEP_ONE_CARD: 'Egy lapot meg kell tartanod az eldobáshoz.',
  SZURAS_BEFORE_FIRST_MELD: 'Szúrni csak az első lerakásod után lehet.',
  SZURAS_ONLY_WITH_HANDOLAS: 'Az első lerakásod körében csak handoláskor szúrhatsz: előbb jelezd a handolást.',
  MELD_NOT_FOUND: 'A lerakott csoport nem található.',
  CARD_DOES_NOT_FIT: 'Ez a lap nem illik ehhez a csoporthoz.',
  JOKER_SWAP_BEFORE_FIRST_MELD: 'Dzsókert cserélni csak az első lerakásod után lehet.',
  CANNOT_REPLACE_JOKER: 'Ez a lap nem helyettesítheti a dzsókert ebben a csoportban.',
  HANDOLAS_ONLY_FIRST_MELD_TURN: 'Handolást csak az első lerakásod körében jelezhetsz.',
  NOTHING_TO_UNDO: 'Nincs mit visszavonni.',
  UNKNOWN_PRESET: (preset, available) => `Ismeretlen preset: „${preset}”. Elérhetők: ${available}.`,
};

module.exports = messages;
