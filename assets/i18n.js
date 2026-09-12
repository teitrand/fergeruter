const STORAGE_KEY = "fergeruter-lang-chosen";
const SUPPORTED = ["nn", "en", "de"];

const WEEKDAYS = {
  nn: ["søndag", "måndag", "tysdag", "onsdag", "torsdag", "fredag", "laurdag"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  de: ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"],
};

const MONTHS = {
  nn: [
    "januar", "februar", "mars", "april", "mai", "juni",
    "juli", "august", "september", "oktober", "november", "desember",
  ],
  en: [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ],
  de: [
    "Januar", "Februar", "März", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember",
  ],
};

const MONTHS_SHORT = {
  nn: ["jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  de: ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"],
};

const STRINGS = {
  nn: {
    "meta.title": "Fergeruter 1136 · Standal–Trandal",
    "meta.description":
      "Trafikkmeldingar frå Fjord1 og seglingsplan for ferjesamband 1136 Standal–Trandal–Sæbø–Skår. Alle anløp i rekkjefølgje, med status for kvar ferja er akkurat no.",
    skip: "Hopp til innhald",
    eyebrow: "Rute 1136 · Fjord1 / FRAM",
    "eyebrow.1135": "Rute 1135 · Fjord1 / FRAM",
    "eyebrow.kombi": "Kombinasjonsrute · Fjord1 / FRAM",
    "route.title1136": "Standal–Trandal–Sæbø–Skår–Valderøya–Store Kalvøy",
    "route.title1135": "Sæbø–Leknes",
    "route.titleKombi": "Sæbø–Leknes–Skår–Trandal–Standal",
    "route.titleSwitch": "{before}, deretter {after}",
    "route.titleAcute": "{table} frå {time}{quay}",
    "mode.acuteNote": "Avgangar mellom {from} og {to} kan vere upålitelege.",
    "split.kicker": "Skifte av rutetabell",
    "split.continues": "{table} frå {time}{quay}",
    "split.before": "Fram til då {before}",
    "split.atQuay": " frå {quay}",
    "split.table.kombi": "kombinasjonsrute",
    "split.table.1136": "rute 1136",
    "split.table.1135": "rute 1135",
    "footer.operatorVessel": "Operatør Fjord1. Ruteeigar FRAM. {name}, tlf. {phone}.",
    "footnote.naisVessel": "{name} på NAIS",
    "footnote.kombiPdf": "FRAM-PDF",
    "lang.label": "Språk",
    "install.app": "Installer app",
    "messages.title": "Trafikkmeldingar",
    "messages.loading": "Hentar frå Fjord1…",
    "messages.filterAria": "Filtrer meldingar",
    "messages.filterLocal": "Hjørundfjorden",
    "messages.filterRoute": "Rute 1136",
    "messages.filterIssues": "Berre avvik",
    "messages.source": "Kjelde",
    "messages.sms": "Få SMS",
    "messages.fetched": "Sist henta {when}",
    "messages.heading": "Trafikkmelding",
    "messages.published": "Publisert {when}",
    "messages.validTo": "Gyldig til {when}",
    "messages.fetchError": "Klarte ikkje hente lokale Fjord1-data.",
    "messages.seeFjord1": "Sjå trafikkmeldingane direkte hos Fjord1.",
    "day.navAria": "Vel dag",
    "day.prev": "Førre dag",
    "day.next": "Neste dag",
    "day.loading": "Lastar rutetabell…",
    "day.today": "I dag",
    "day.tomorrow": "i morgon",
    "stop.filterAria": "Filtrer på stoppestad",
    "conn.label": "Korrespondanse",
    "conn.none": "Ingen",
    "conn.note":
      "Korrespondansen reknar {drive} min køyring {hub}–{roadTo} pluss {margin} min margin.",
    "conn.error": "Klarte ikkje hente korresponderande ruter.",
    "conn.takeFerry": "Ta ferja {time} frå {from} for å rekke denne",
    "conn.noInbound": "Ingen korresponderande ferje frå {hub}-sida",
    "conn.onward": "Vidare {time} frå {hub} mot {to}",
    "conn.noOutbound": "Ingen korresponderande ferje frå {hub} etterpå",
    "position.planned":
      "Posisjonen er rekna ut frå rutetabellen når Entur ikkje sender køyretøyposisjon.",
    "position.live": "Posisjonen kjem frå Entur i sanntid no.",
    "footnote.signal": "Signalturar må tingast på telefon innan fristen.",
    "footnote.timetable": "Rutetabellen blir berre lasta ned att når han er endra.",
    "footnote.pdf": "Papir-ruteplan",
    "footnote.nais": "M/F Kvernes på NAIS",
    "footnote.ais": "(AIS frå Kystverket)",
    "footer.operator": "Operatør Fjord1. Ruteeigar FRAM. M/F Kvernes, tlf. 916 69 340.",
    "footer.holidays":
      "Nokre turar går berre på signal. Ved jul, nyttår og høgtid: sjå FRAM-appen.",
    "severity.normal": "Normal drift",
    "severity.delay": "Forsinking",
    "severity.cancelled": "Innstilt",
    "severity.capacity": "Kapasitet",
    "severity.info": "Melding",
    "duration.now": "no",
    "duration.minutes": "{n} min",
    "duration.hours": "{n} t",
    "duration.hoursMinutes": "{n} t {m} min",
    "countdown.in": "om {duration}",
    "delay.about": "om lag {n} min forsinka",
    "live.fromEntur": "{text} (sanntid frå Entur).",
    "status.underwayTo": "Ferja er på veg mot {dest}",
    "status.onSchedule": "Ferja er i rute",
    "status.mooredAt": "Ferja ligg til kai på {quay}",
    "status.firstDeparture": "Ferja ligg til kai på {from}. Fyrste avgang {time}.",
    "status.doneAt": "Ferja er ferdig for dagen på {home}",
    "status.doneAtPeriod": "Ferja er ferdig for dagen på {home}.",
    "status.backEmpty": "Ferja går tilbake til {home} utan passasjerar",
    "status.backEmptyText":
      "Siste passasjertur er framme på {to}. Ferja går tilbake til {home} utan passasjerar.",
    "status.backOvernightText":
      "Siste passasjertur er framme på {to}. Ferja går tilbake til {home} utan passasjerar og ligg der over natta.",
    "status.doneMoored": "Ferja er ferdig for dagen og ligg til kai på {home}.",
    "status.repositionTo": "Ferja går til {quay} utan passasjerar",
    "next.fromTo": "Frå {from} til {to}",
    "next.from": "Frå {from}",
    "next.arrival": "Ankomst {to}",
    "sailing.route": "{from} → {to}",
    "sailing.arrival": "Ankomst {time}",
    "sailing.departure": "Avgang {time}",
    "signal.onRequest": "På signal",
    "signal.callBy": "Ring innan {time}",
    "signal.leftToBook": "{duration} igjen å tinge",
    "signal.expired": "fristen er ute",
    gone: "Gått",
    "transfer.moves": "Ferja flyttar seg til {to}",
    "transfer.noPassengers": "Ikkje persontrafikk mellom {from} og {to}",
    "transfer.empty": "Utan passasjerar",
    now: "No",
    "stops.all": "Alle stopp",
    "view.label": "Visning",
    "view.arrivals": "Ankomsttider",
    "view.hideArrivals": "Skjul ankomsttider",
    "view.showArrivals": "Vis ankomsttider",
    "lede.noTripsToday": "Ingen turar i rutetabellen i dag.",
    "lede.nextDeparture": "Neste avgang {time} frå {from}, {countdown}",
    "reveal.hide": "Skjul tidlegare avgangar",
    "reveal.show": "Vis {n} tidlegare avgangar",
    "empty.noTimetable": "Fann ikkje rutetabell.",
    "empty.noTripsDay": "Ingen turar i tabellen denne dagen.",
    "empty.noIssues": "Ingen avvik i området no.",
    "empty.noMessages": "Ingen gjeldande meldingar for området.",
    "timetable.updated": "Sist lasta ned {date}. ",
    "timetable.loadError": "Klarte ikkje lasta rutetabellen",
    "timetable.notLoaded": "Rutetabellen er ikkje lasta ned enno.",
    "date.full": "{weekday} {day}. {month}",
    "date.only": "{day}. {month} {year}",
    "date.time": "{weekday} {day}. {month}. {hour}:{minute}",
    "feedback.open": "Gje tilbakemelding",
    "feedback.title": "Tilbakemelding",
    "feedback.lead": "Hjelper sida deg å finne ferja?",
    "feedback.yes": "Ja, nyttig",
    "feedback.no": "Nei, noko manglar",
    "feedback.thanks": "Takk! Det hjelper oss å forstå korleis sida blir brukt.",
    "feedback.commentLabel": "Vil du seie meir? (valfritt)",
    "feedback.commentPlaceholder": "Til dømes kva som manglar, eller kva du brukar sida til.",
    "feedback.send": "Send melding",
    "feedback.close": "Lukk",
    "feedback.privacy":
      "Ja/nei blir talde anonymt, utan namn eller e-post. Ei skriftleg melding opnar e-posten din og blir ikkje lagra i statistikken.",
    "feedback.github": "Eller meld ein feil på GitHub",
    "feedback.mailSubject": "Tilbakemelding på Fergeruter 1136",
    "feedback.mailBody": "Vurdering: {rating}\n\n{comment}",
    "feedback.mailNoComment": "(inga melding)",
  },
  en: {
    "meta.title": "Ferry times 1136 · Standal–Trandal",
    "meta.description":
      "Traffic notices from Fjord1 and the sailing schedule for ferry route 1136 Standal–Trandal–Sæbø–Skår. Every call in order, with where the ferry is right now.",
    skip: "Skip to content",
    eyebrow: "Route 1136 · Fjord1 / FRAM",
    "eyebrow.1135": "Route 1135 · Fjord1 / FRAM",
    "eyebrow.kombi": "Combined timetable · Fjord1 / FRAM",
    "route.title1136": "Standal–Trandal–Sæbø–Skår–Valderøya–Store Kalvøy",
    "route.title1135": "Sæbø–Leknes",
    "route.titleKombi": "Sæbø–Leknes–Skår–Trandal–Standal",
    "route.titleSwitch": "{before}, then {after}",
    "route.titleAcute": "{table} from {time}{quay}",
    "mode.acuteNote": "Departures between {from} and {to} may be unreliable.",
    "split.kicker": "Timetable change",
    "split.continues": "{table} from {time}{quay}",
    "split.before": "Until then {before}",
    "split.atQuay": " from {quay}",
    "split.table.kombi": "combined timetable",
    "split.table.1136": "route 1136",
    "split.table.1135": "route 1135",
    "footer.operatorVessel": "Operator Fjord1. Route owner FRAM. {name}, tel. {phone}.",
    "footnote.naisVessel": "{name} on NAIS",
    "footnote.kombiPdf": "FRAM PDF",
    "lang.label": "Language",
    "install.app": "Install app",
    "messages.title": "Traffic notices",
    "messages.loading": "Fetching from Fjord1…",
    "messages.filterAria": "Filter notices",
    "messages.filterLocal": "Hjørundfjorden",
    "messages.filterRoute": "Route 1136",
    "messages.filterIssues": "Disruptions only",
    "messages.source": "Source",
    "messages.sms": "Get SMS",
    "messages.fetched": "Last fetched {when}",
    "messages.heading": "Traffic notice",
    "messages.published": "Published {when}",
    "messages.validTo": "Valid until {when}",
    "messages.fetchError": "Could not load local Fjord1 data.",
    "messages.seeFjord1": "See traffic notices directly at Fjord1.",
    "day.navAria": "Choose day",
    "day.prev": "Previous day",
    "day.next": "Next day",
    "day.loading": "Loading timetable…",
    "day.today": "Today",
    "day.tomorrow": "tomorrow",
    "stop.filterAria": "Filter by stop",
    "conn.label": "Connections",
    "conn.none": "None",
    "conn.note":
      "Connections include {drive} min driving {hub}–{roadTo} plus a {margin} min buffer.",
    "conn.error": "Could not load connecting routes.",
    "conn.takeFerry": "Take the {time} ferry from {from} to make this",
    "conn.noInbound": "No connecting ferry from the {hub} side",
    "conn.onward": "Onward {time} from {hub} towards {to}",
    "conn.noOutbound": "No connecting ferry from {hub} afterwards",
    "position.planned":
      "Position is calculated from the timetable when Entur is not sending a vehicle position.",
    "position.live": "Position is from Entur live data now.",
    "footnote.signal": "On-request sailings must be booked by phone before the deadline.",
    "footnote.timetable": "The timetable is only downloaded again when it has changed.",
    "footnote.pdf": "Printed timetable",
    "footnote.nais": "M/F Kvernes on NAIS",
    "footnote.ais": "(AIS from Kystverket)",
    "footer.operator": "Operator Fjord1. Route owner FRAM. M/F Kvernes, tel. 916 69 340.",
    "footer.holidays":
      "Some sailings are on request only. At Christmas, New Year and public holidays: see the FRAM app.",
    "severity.normal": "Normal service",
    "severity.delay": "Delay",
    "severity.cancelled": "Cancelled",
    "severity.capacity": "Capacity",
    "severity.info": "Notice",
    "duration.now": "now",
    "duration.minutes": "{n} min",
    "duration.hours": "{n} h",
    "duration.hoursMinutes": "{n} h {m} min",
    "countdown.in": "in {duration}",
    "delay.about": "about {n} min delayed",
    "live.fromEntur": "{text} (live from Entur).",
    "status.underwayTo": "The ferry is heading to {dest}",
    "status.onSchedule": "The ferry is on schedule",
    "status.mooredAt": "The ferry is at {quay}",
    "status.firstDeparture": "The ferry is at {from}. First departure {time}.",
    "status.doneAt": "The ferry has finished for the day at {home}",
    "status.doneAtPeriod": "The ferry has finished for the day at {home}.",
    "status.backEmpty": "The ferry is returning to {home} without passengers",
    "status.backEmptyText":
      "The last passenger sailing has arrived at {to}. The ferry is returning to {home} without passengers.",
    "status.backOvernightText":
      "The last passenger sailing has arrived at {to}. The ferry is returning to {home} without passengers and stays there overnight.",
    "status.doneMoored": "The ferry has finished for the day and is moored at {home}.",
    "status.repositionTo": "The ferry is moving to {quay} without passengers",
    "next.fromTo": "From {from} to {to}",
    "next.from": "From {from}",
    "next.arrival": "Arrival {to}",
    "sailing.route": "{from} → {to}",
    "sailing.arrival": "Arrival {time}",
    "sailing.departure": "Departure {time}",
    "signal.onRequest": "On request",
    "signal.callBy": "Call by {time}",
    "signal.leftToBook": "{duration} left to book",
    "signal.expired": "booking closed",
    gone: "Departed",
    "transfer.moves": "The ferry repositions to {to}",
    "transfer.noPassengers": "No passenger service between {from} and {to}",
    "transfer.empty": "Without passengers",
    now: "Now",
    "stops.all": "All stops",
    "view.label": "Display",
    "view.arrivals": "Arrival times",
    "view.hideArrivals": "Hide arrival times",
    "view.showArrivals": "Show arrival times",
    "lede.noTripsToday": "No sailings in the timetable today.",
    "lede.nextDeparture": "Next departure {time} from {from}, {countdown}",
    "reveal.hide": "Hide earlier departures",
    "reveal.show": "Show {n} earlier departures",
    "empty.noTimetable": "Timetable not found.",
    "empty.noTripsDay": "No sailings in the timetable this day.",
    "empty.noIssues": "No disruptions in the area now.",
    "empty.noMessages": "No current notices for the area.",
    "timetable.updated": "Last downloaded {date}. ",
    "timetable.loadError": "Error loading timetable",
    "timetable.notLoaded": "The timetable has not been downloaded yet.",
    "date.full": "{weekday} {day} {month}",
    "date.only": "{day} {month} {year}",
    "date.time": "{weekday} {day} {month} {hour}:{minute}",
    "feedback.open": "Send feedback",
    "feedback.title": "Feedback",
    "feedback.lead": "Does this page help you find the ferry?",
    "feedback.yes": "Yes, useful",
    "feedback.no": "No, something is missing",
    "feedback.thanks": "Thanks! That helps us understand how the page is used.",
    "feedback.commentLabel": "Want to say more? (optional)",
    "feedback.commentPlaceholder": "For example what is missing, or what you use the page for.",
    "feedback.send": "Send message",
    "feedback.close": "Close",
    "feedback.privacy":
      "Yes/no is counted anonymously, without your name or email. A written message opens your email app and is not stored in the statistics.",
    "feedback.github": "Or report a bug on GitHub",
    "feedback.mailSubject": "Feedback on Ferry times 1136",
    "feedback.mailBody": "Rating: {rating}\n\n{comment}",
    "feedback.mailNoComment": "(no message)",
  },
  de: {
    "meta.title": "Fährzeiten 1136 · Standal–Trandal",
    "meta.description":
      "Verkehrsmeldungen von Fjord1 und Fahrplan für die Fährlinie 1136 Standal–Trandal–Sæbø–Skår. Alle Anläufe der Reihe nach, mit Status wo die Fähre gerade ist.",
    skip: "Zum Inhalt springen",
    eyebrow: "Linie 1136 · Fjord1 / FRAM",
    "eyebrow.1135": "Linie 1135 · Fjord1 / FRAM",
    "eyebrow.kombi": "Kombinationsfahrplan · Fjord1 / FRAM",
    "route.title1136": "Standal–Trandal–Sæbø–Skår–Valderøya–Store Kalvøy",
    "route.title1135": "Sæbø–Leknes",
    "route.titleKombi": "Sæbø–Leknes–Skår–Trandal–Standal",
    "route.titleSwitch": "{before}, danach {after}",
    "route.titleAcute": "{table} ab {time}{quay}",
    "mode.acuteNote": "Abfahrten zwischen {from} und {to} können unzuverlässig sein.",
    "split.kicker": "Fahrplanwechsel",
    "split.continues": "{table} ab {time}{quay}",
    "split.before": "Bis dahin {before}",
    "split.atQuay": " von {quay}",
    "split.table.kombi": "Kombinationsfahrplan",
    "split.table.1136": "Linie 1136",
    "split.table.1135": "Linie 1135",
    "footer.operatorVessel": "Betreiber Fjord1. Auftraggeber FRAM. {name}, Tel. {phone}.",
    "footnote.naisVessel": "{name} auf NAIS",
    "footnote.kombiPdf": "FRAM-PDF",
    "lang.label": "Sprache",
    "install.app": "App installieren",
    "messages.title": "Verkehrsmeldungen",
    "messages.loading": "Wird von Fjord1 geladen…",
    "messages.filterAria": "Meldungen filtern",
    "messages.filterLocal": "Hjørundfjorden",
    "messages.filterRoute": "Linie 1136",
    "messages.filterIssues": "Nur Störungen",
    "messages.source": "Quelle",
    "messages.sms": "SMS erhalten",
    "messages.fetched": "Zuletzt abgerufen {when}",
    "messages.heading": "Verkehrsmeldung",
    "messages.published": "Veröffentlicht {when}",
    "messages.validTo": "Gültig bis {when}",
    "messages.fetchError": "Lokale Fjord1-Daten konnten nicht geladen werden.",
    "messages.seeFjord1": "Verkehrsmeldungen direkt bei Fjord1 ansehen.",
    "day.navAria": "Tag wählen",
    "day.prev": "Vorheriger Tag",
    "day.next": "Nächster Tag",
    "day.loading": "Fahrplan wird geladen…",
    "day.today": "Heute",
    "day.tomorrow": "morgen",
    "stop.filterAria": "Nach Anleger filtern",
    "conn.label": "Anschluss",
    "conn.none": "Keine",
    "conn.note":
      "Der Anschluss rechnet {drive} Min. Fahrt {hub}–{roadTo} plus {margin} Min. Puffer.",
    "conn.error": "Anschlussfahrpläne konnten nicht geladen werden.",
    "conn.takeFerry": "Nehmen Sie die Fähre um {time} von {from}, um diese zu erreichen",
    "conn.noInbound": "Keine Anschlussfähre von der {hub}-Seite",
    "conn.onward": "Weiter um {time} von {hub} nach {to}",
    "conn.noOutbound": "Keine Anschlussfähre von {hub} danach",
    "position.planned":
      "Die Position wird aus dem Fahrplan berechnet, wenn Entur keine Fahrzeugposition sendet.",
    "position.live": "Die Position kommt jetzt aus Entur-Echtzeit.",
    "footnote.signal":
      "Signalfahrten müssen telefonisch innerhalb der Frist angemeldet werden.",
    "footnote.timetable":
      "Der Fahrplan wird nur erneut heruntergeladen, wenn er sich geändert hat.",
    "footnote.pdf": "Fahrplan als PDF",
    "footnote.nais": "M/F Kvernes auf NAIS",
    "footnote.ais": "(AIS von Kystverket)",
    "footer.operator": "Betreiber Fjord1. Auftraggeber FRAM. M/F Kvernes, Tel. 916 69 340.",
    "footer.holidays":
      "Einige Fahrten verkehren nur auf Signal. An Weihnachten, Neujahr und Feiertagen: siehe FRAM-App.",
    "severity.normal": "Normalbetrieb",
    "severity.delay": "Verspätung",
    "severity.cancelled": "Ausgefallen",
    "severity.capacity": "Kapazität",
    "severity.info": "Hinweis",
    "duration.now": "jetzt",
    "duration.minutes": "{n} Min.",
    "duration.hours": "{n} Std.",
    "duration.hoursMinutes": "{n} Std. {m} Min.",
    "countdown.in": "in {duration}",
    "delay.about": "ca. {n} Min. verspätet",
    "live.fromEntur": "{text} (Echtzeit von Entur).",
    "status.underwayTo": "Die Fähre ist unterwegs nach {dest}",
    "status.onSchedule": "Die Fähre ist pünktlich",
    "status.mooredAt": "Die Fähre liegt am Anleger {quay}",
    "status.firstDeparture": "Die Fähre liegt am Anleger {from}. Erste Abfahrt {time}.",
    "status.doneAt": "Die Fähre hat den Betriebstag in {home} beendet",
    "status.doneAtPeriod": "Die Fähre hat den Betriebstag in {home} beendet.",
    "status.backEmpty": "Die Fähre kehrt ohne Passagiere nach {home} zurück",
    "status.backEmptyText":
      "Die letzte Passagierfahrt ist in {to} angekommen. Die Fähre kehrt ohne Passagiere nach {home} zurück.",
    "status.backOvernightText":
      "Die letzte Passagierfahrt ist in {to} angekommen. Die Fähre kehrt ohne Passagiere nach {home} zurück und bleibt dort über Nacht.",
    "status.doneMoored":
      "Die Fähre hat den Betriebstag beendet und liegt am Anleger {home}.",
    "status.repositionTo": "Die Fähre fährt ohne Passagiere nach {quay}",
    "next.fromTo": "Von {from} nach {to}",
    "next.from": "Von {from}",
    "next.arrival": "Ankunft {to}",
    "sailing.route": "{from} → {to}",
    "sailing.arrival": "Ankunft {time}",
    "sailing.departure": "Abfahrt {time}",
    "signal.onRequest": "Auf Signal",
    "signal.callBy": "Anrufen bis {time}",
    "signal.leftToBook": "noch {duration} zum Anmelden",
    "signal.expired": "Frist abgelaufen",
    gone: "Abgefahren",
    "transfer.moves": "Die Fähre wechselt nach {to}",
    "transfer.noPassengers": "Kein Personenverkehr zwischen {from} und {to}",
    "transfer.empty": "Ohne Passagiere",
    now: "Jetzt",
    "stops.all": "Alle Anleger",
    "view.label": "Anzeige",
    "view.arrivals": "Ankunftszeiten",
    "view.hideArrivals": "Ankunftszeiten ausblenden",
    "view.showArrivals": "Ankunftszeiten anzeigen",
    "lede.noTripsToday": "Heute stehen keine Fahrten im Fahrplan.",
    "lede.nextDeparture": "Nächste Abfahrt {time} von {from}, {countdown}",
    "reveal.hide": "Frühere Abfahrten ausblenden",
    "reveal.show": "{n} frühere Abfahrten anzeigen",
    "empty.noTimetable": "Fahrplan nicht gefunden.",
    "empty.noTripsDay": "Keine Fahrten an diesem Tag.",
    "empty.noIssues": "Derzeit keine Störungen im Gebiet.",
    "empty.noMessages": "Keine aktuellen Meldungen für das Gebiet.",
    "timetable.updated": "Zuletzt heruntergeladen {date}. ",
    "timetable.loadError": "Fehler beim Laden des Fahrplans",
    "timetable.notLoaded": "Der Fahrplan ist noch nicht heruntergeladen.",
    "date.full": "{weekday}, {day}. {month}",
    "date.only": "{day}. {month} {year}",
    "date.time": "{weekday} {day}. {month}. {hour}:{minute}",
    "feedback.open": "Feedback geben",
    "feedback.title": "Feedback",
    "feedback.lead": "Hilft Ihnen die Seite, die Fähre zu finden?",
    "feedback.yes": "Ja, hilfreich",
    "feedback.no": "Nein, etwas fehlt",
    "feedback.thanks": "Danke! Das hilft uns zu verstehen, wie die Seite genutzt wird.",
    "feedback.commentLabel": "Möchten Sie noch etwas sagen? (optional)",
    "feedback.commentPlaceholder":
      "Zum Beispiel, was fehlt, oder wofür Sie die Seite nutzen.",
    "feedback.send": "Nachricht senden",
    "feedback.close": "Schließen",
    "feedback.privacy":
      "Ja/nein wird anonym gezählt, ohne Namen oder E-Mail. Eine schriftliche Nachricht öffnet Ihr E-Mail-Programm und wird nicht in der Statistik gespeichert.",
    "feedback.github": "Oder einen Fehler auf GitHub melden",
    "feedback.mailSubject": "Feedback zu Fährzeiten 1136",
    "feedback.mailBody": "Bewertung: {rating}\n\n{comment}",
    "feedback.mailNoComment": "(keine Nachricht)",
  },
};

let lang = "nn";

function interpolate(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] == null ? `{${key}}` : String(vars[key])
  );
}

export function t(key, vars) {
  const table = STRINGS[lang] || STRINGS.nn;
  const text = table[key] ?? STRINGS.nn[key] ?? key;
  return interpolate(text, vars);
}

export function getLang() {
  return lang;
}

export function weekdays() {
  return WEEKDAYS[lang] || WEEKDAYS.nn;
}

export function months() {
  return MONTHS[lang] || MONTHS.nn;
}

export function monthsShort() {
  return MONTHS_SHORT[lang] || MONTHS_SHORT.nn;
}

export function matchSupportedLang(tag) {
  const primary = String(tag || "")
    .toLowerCase()
    .replace(/_/g, "-")
    .split("-")[0];
  if (primary === "nn" || primary === "nb" || primary === "no") return "nn";
  if (primary === "de") return "de";
  if (primary === "en") return "en";
  return null;
}

export function detectLang({ languages, storage } = {}) {
  try {
    const store =
      storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    const saved = store && store.getItem(STORAGE_KEY);
    if (saved && STRINGS[saved]) return saved;
  } catch {
    // localStorage kan vere stengt.
  }
  const nav =
    languages ??
    (typeof navigator !== "undefined"
      ? navigator.languages && navigator.languages.length
        ? navigator.languages
        : [navigator.language]
      : []);
  for (const raw of nav) {
    const matched = matchSupportedLang(raw);
    if (matched) return matched;
  }
  return "nn";
}

export function setLang(next, { persist = true, storage } = {}) {
  lang = STRINGS[next] ? next : "nn";
  if (persist) {
    try {
      const store =
        storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
      if (store) store.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore
    }
  }
  return lang;
}

export function applyStaticTranslations() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang;
  document.title = t("meta.title");
  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute("content", t("meta.description"));
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((node) => {
    node.setAttribute("aria-label", t(node.getAttribute("data-i18n-aria")));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    node.setAttribute("placeholder", t(node.getAttribute("data-i18n-placeholder")));
  });
}

export function stringKeys() {
  return Object.keys(STRINGS.nn);
}

export function stringsFor(code) {
  return STRINGS[code] || null;
}

export { SUPPORTED, STORAGE_KEY };
