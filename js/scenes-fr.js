// Role-play scenes (en-fr, Paris v2 stage 5): data + the offline engine.
// Pure functions, no DOM. Loaded by learn.html (global CLSCENES), required by
// netlify/functions/converse.js (scene goal, facts and words for the AI
// partner), scripts/gen-fr-audio.mjs (every NPC line gets static audio) and
// the tests.
//
// A scene is a small graph. Each node is one line the other side says (npc:
// [French, English]) and the intents he can answer with. An intent matches
// when the typed/dictated French grades as one of its examples (CLSRS
// grader) or, failing that, when every keyword group has a hit (folded text:
// no case, accents or punctuation). Asking for a repeat ("Pardon ?",
// "Vous pouvez répéter ?", "plus lentement") always counts as a good move.
// Variants change one fact on replay (sold out, other platform, a wrong price);
// `{name}` in a line is filled from the variant.
(function (root) {
  var SR = root.CLSRS || (typeof require === 'function' ? require('./srs.js') : null);

  var PAY = [['voila', 'carte', 'espece', 'liquide', 'tenez', 'sans contact', 'payer', 'paie', 'paye', 'cash']];
  var THANKS = [['merci', 'bonne journee', 'bonne soiree', 'au revoir', 'vous aussi', 'a vous', 'parfait', 'd accord', 'ok', 'super']];
  var YES = [['oui', 'd accord', 'ok', 'volontiers', 'parfait', 'tres bien', 'ca va', 'ca marche', 'bien sur', 'pourquoi pas']];

  var SCENES = [
    {
      id: 'cafe', title: 'Café', icon: '☕', role: 'a waiter at a Paris café counter',
      goal: 'Order a coffee and a croissant, then pay.',
      vars: [
        { price: 'six euros cinquante', priceEn: '€6.50', ai: 'The total is six euros cinquante.' },
        { price: 'six euros cinquante', priceEn: '€6.50', soldOut: true, ai: 'Croissants are sold out today: offer a pain au chocolat instead. Total six euros cinquante.', note: 'This time the croissants were sold out.' },
        { price: 'seize euros cinquante', priceEn: '€16.50', overcharge: true, ai: 'You first ask for seize euros cinquante by mistake; if the customer questions it, apologise: it is six euros cinquante.', note: 'They said seize euros cinquante (€16.50), not six euros cinquante (€6.50).' }
      ],
      start: 'hello',
      nodes: {
        hello: { npc: ["Bonjour ! Qu'est-ce que je vous sers ?", 'Hello! What can I get you?'], intents: [
          { kw: [['cafe', 'express', 'creme', 'noisette', 'the', 'chocolat chaud'], ['croissant']], next: function (v) { return v.soldOut ? 'nocroissant' : 'here'; },
            ex: ["Un café et un croissant, s'il vous plaît.", "Je voudrais un café et un croissant, s'il vous plaît."], en: 'A coffee and a croissant, please.' },
          { kw: [['cafe', 'express', 'creme', 'noisette', 'the', 'chocolat chaud']], next: 'more',
            ex: ["Un café, s'il vous plaît."], en: 'A coffee, please.' },
          { kw: [['croissant']], next: function (v) { return v.soldOut ? 'nocroissant' : 'more'; },
            ex: ["Un croissant, s'il vous plaît."], en: 'A croissant, please.' }
        ] },
        more: { npc: ['Très bien. Et avec ceci ?', 'Very good. Anything else?'], intents: [
          { kw: [['croissant']], next: function (v) { return v.soldOut ? 'nocroissant' : 'here'; }, ex: ["Un croissant, s'il vous plaît."], en: 'A croissant, please.' },
          { kw: [['cafe', 'express', 'creme', 'the']], next: 'here', ex: ["Et un café, s'il vous plaît."], en: 'And a coffee, please.' },
          { kw: [['c est tout', 'ca sera tout', 'rien', 'non merci', 'ca ira']], next: 'here', ex: ["C'est tout, merci."], en: "That's all, thanks." }
        ] },
        nocroissant: { only: 'soldOut', npc: ["Désolé, il n'y a plus de croissants. Un pain au chocolat ?", 'Sorry, there are no croissants left. A pain au chocolat?'], intents: [
          { kw: YES.concat([]), alt: [['pain au chocolat']], next: 'here', ex: ["Oui, un pain au chocolat, s'il vous plaît."], en: 'Yes, a pain au chocolat, please.' },
          { kw: [['non']], next: 'here', ex: ['Non merci, juste le café.'], en: 'No thanks, just the coffee.' }
        ] },
        here: { npc: ['Sur place ou à emporter ?', 'For here or to go?'], intents: [
          { kw: [['sur place', 'ici', 'place']], next: 'pay', ex: ["Sur place, s'il vous plaît."], en: 'For here, please.' },
          { kw: [['emporter', 'emporte']], next: 'pay', ex: ["À emporter, s'il vous plaît."], en: 'To go, please.' }
        ] },
        pay: { npc: ['Très bien. Ça fait {price}.', "Fine. That's {priceEn}."], intents: [
          { only: 'overcharge', catches: true, kw: [['erreur', 'seize', '16', 'trop', 'cher', 'vraiment', 'pas possible', 'six euros']], next: 'fixed',
            ex: ['Seize euros ? Il y a une erreur, non ?'], en: "Sixteen euros? There's a mistake, isn't there?" },
          { kw: PAY, next: 'bye', ex: ["Par carte, s'il vous plaît."], en: 'By card, please.' }
        ] },
        fixed: { only: 'overcharge', npc: ['Oh, pardon ! Six euros cinquante, bien sûr.', 'Oh, sorry! Six fifty, of course.'], intents: [
          { kw: PAY.concat([]), alt: THANKS, next: 'bye', ex: ['Voilà. Merci.'], en: 'Here you go. Thanks.' }
        ] },
        bye: { final: true, npc: ['Merci. Bonne journée !', 'Thank you. Have a good day!'], intents: [
          { kw: THANKS, next: null, ex: ['Merci, vous aussi. Au revoir !'], en: 'Thanks, you too. Goodbye!' }
        ] }
      }
    },
    {
      id: 'boulangerie', title: 'Boulangerie', icon: '🥖', role: 'the person at the counter of a Paris boulangerie',
      goal: 'Buy a baguette tradition and two croissants, then pay.',
      vars: [
        { price: 'quatre euros', priceEn: '€4.00', ai: 'A tradition is one euro quarante, a croissant one euro trente. Card is fine.' },
        { price: 'quatre euros', priceEn: '€4.00', soldOut: true, ai: 'Traditions are sold out: offer a regular baguette. Card is fine.', note: 'This time the traditions were sold out.' },
        { price: 'quatre euros', priceEn: '€4.00', cardMin: true, ai: 'Card only from five euros: if the customer wants to pay by card, say so; cash is fine, or they can add something (then the total is five euros soixante).', note: 'This time card was only from €5: pay cash or add something.' }
      ],
      start: 'hello',
      nodes: {
        hello: { npc: ['Bonjour ! Vous désirez ?', 'Hello! What would you like?'], intents: [
          { kw: [['tradition', 'baguette'], ['croissant']], next: function (v) { return v.soldOut ? 'notrad' : 'total'; },
            ex: ["Une tradition et deux croissants, s'il vous plaît."], en: 'A baguette tradition and two croissants, please.' },
          { kw: [['tradition', 'baguette']], next: function (v) { return v.soldOut ? 'notrad' : 'more'; },
            ex: ["Une tradition, s'il vous plaît."], en: 'A baguette tradition, please.' },
          { kw: [['croissant']], next: 'more', ex: ["Deux croissants, s'il vous plaît."], en: 'Two croissants, please.' }
        ] },
        notrad: { only: 'soldOut', npc: ["Désolé, il n'y a plus de tradition. Une baguette classique, ça va ?", "Sorry, there are no traditions left. A regular baguette, is that OK?"], intents: [
          { kw: YES, next: 'more', ex: ["Oui, une baguette classique, s'il vous plaît."], en: 'Yes, a regular baguette, please.' },
          { kw: [['non']], next: 'more', ex: ['Non merci.'], en: 'No thanks.' }
        ] },
        more: { npc: ['Et avec ceci ?', 'Anything else?'], intents: [
          { kw: [['croissant']], next: 'total', ex: ["Deux croissants, s'il vous plaît."], en: 'Two croissants, please.' },
          { kw: [['tradition', 'baguette']], next: 'total', ex: ["Et une tradition, s'il vous plaît."], en: 'And a baguette tradition, please.' },
          { kw: [['c est tout', 'ca sera tout', 'rien', 'non merci', 'ca ira']], next: 'total', ex: ["C'est tout, merci."], en: "That's all, thanks." }
        ] },
        total: { npc: ['Ça fait {price}. Carte ou espèces ?', "That's {priceEn}. Card or cash?"], intents: [
          { kw: [['carte', 'sans contact']], next: function (v) { return v.cardMin ? 'cardmin' : 'bye'; }, ex: ["Par carte, s'il vous plaît."], en: 'By card, please.' },
          { kw: [['espece', 'liquide', 'voila', 'monnaie', 'tenez', 'cash']], next: 'bye', ex: ['En espèces. Voilà.'], en: 'Cash. Here you go.' }
        ] },
        cardmin: { only: 'cardMin', npc: ["Désolé, la carte, c'est à partir de cinq euros.", 'Sorry, card is only from five euros.'], intents: [
          { catches: true, kw: [['espece', 'liquide', 'voila', 'monnaie', 'tenez', 'cash']], next: 'bye', ex: ['Ah, d\'accord. En espèces, alors.'], en: 'Ah, OK. Cash, then.' },
          { catches: true, kw: [['croissant', 'pain', 'chocolat', 'autre', 'aussi', 'encore', 'ajout', 'tarte', 'eclair']], next: 'total2', ex: ["Alors, un pain au chocolat aussi, s'il vous plaît."], en: 'Then a pain au chocolat too, please.' }
        ] },
        total2: { only: 'cardMin', npc: ["D'accord. Alors, ça fait cinq euros soixante.", "OK. So that's €5.60."], intents: [
          { kw: PAY, next: 'bye', ex: ['Par carte. Voilà.'], en: 'By card. Here you go.' }
        ] },
        bye: { final: true, npc: ['Merci, bonne journée !', 'Thanks, have a good day!'], intents: [
          { kw: THANKS, next: null, ex: ['Merci, au revoir !'], en: 'Thanks, goodbye!' }
        ] }
      }
    },
    {
      id: 'restaurant', title: 'Restaurant', icon: '🍷', role: 'a waiter in a Paris bistro, in the evening', greet: 'Bonsoir',
      goal: 'Get a table for two, order the dish of the day, ask for the bill and pay.',
      vars: [
        { dish: 'le bœuf bourguignon', dishEn: 'beef bourguignon', bill: 'trente-deux euros', billEn: '€32', ai: 'The dish of the day is le bœuf bourguignon. The bill is trente-deux euros.' },
        { dish: 'le bœuf bourguignon', dishEn: 'beef bourguignon', bill: 'trente-deux euros', billEn: '€32', soldOut: true, ai: 'The dish of the day (le bœuf bourguignon) is finished: offer le poulet rôti instead. The bill is trente-deux euros.', note: 'This time the dish of the day was finished.' },
        { dish: 'le bœuf bourguignon', dishEn: 'beef bourguignon', bill: 'cinquante-deux euros', billEn: '€52', overcharge: true, ai: 'You bring a bill of cinquante-deux euros by mistake; if the customer questions it, apologise: it is trente-deux euros.', note: 'The bill said cinquante-deux euros (€52), not trente-deux (€32).' }
      ],
      start: 'hello',
      nodes: {
        hello: { npc: ['Bonsoir ! Vous êtes combien ?', 'Good evening! How many of you?'], intents: [
          { kw: [['deux', '2', 'trois', 'quatre', 'un', 'une', 'seul', 'table']], next: 'resa', ex: ["Bonsoir, une table pour deux, s'il vous plaît."], en: 'Good evening, a table for two, please.' }
        ] },
        resa: { npc: ['Vous avez réservé ?', 'Do you have a reservation?'], intents: [
          { kw: [['non', 'pas de']], next: 'seat', ex: ['Non, désolé. Vous avez de la place ?'], en: "No, sorry. Do you have room?" },
          { kw: [['oui', 'au nom']], next: 'seat', ex: ["Oui, au nom de Cannon."], en: 'Yes, under the name Cannon.' }
        ] },
        seat: { npc: ['Très bien, suivez-moi. Voici la carte. Vous avez choisi ?', 'Very good, follow me. Here is the menu. Have you decided?'], intents: [
          { kw: [['c est quoi', 'qu est ce que', 'quel est', 'recommand', 'conseill']], next: 'whatis', ex: ["C'est quoi, le plat du jour ?"], en: "What's the dish of the day?" },
          { kw: [['plat du jour']], next: function (v) { return v.soldOut ? 'nodish' : 'drink'; }, ex: ["Le plat du jour, s'il vous plaît."], en: 'The dish of the day, please.' },
          { kw: [['poulet', 'steak', 'canard', 'boeuf', 'salade', 'poisson', 'je vais prendre', 'je voudrais', 'je prends', 'confit', 'soupe']], next: 'drink', ex: ['Je vais prendre le confit de canard.'], en: "I'll have the duck confit." }
        ] },
        whatis: { npc: ["Aujourd'hui, c'est {dish}.", "Today it's {dishEn}."], intents: [
          { kw: [['je vais prendre', 'je prends', 'oui', 'd accord', 'je voudrais', 'parfait', 'ca', 'le plat', 'bourguignon', 'pour moi', 'deux', 'tres bien']], next: function (v) { return v.soldOut ? 'nodish' : 'drink'; }, ex: ['Parfait, je vais prendre ça.'], en: "Perfect, I'll have that." },
          { kw: [['non', 'autre', 'salade', 'poisson', 'steak', 'poulet']], next: 'drink', ex: ['Je vais prendre le poulet, plutôt.'], en: "I'll have the chicken instead." }
        ] },
        nodish: { only: 'soldOut', npc: ["Ah, désolé, il n'y a plus de plat du jour. Il nous reste du poulet rôti.", "Ah, sorry, there's no dish of the day left. We still have roast chicken."], intents: [
          { kw: [['poulet', 'oui', 'd accord', 'ok', 'je vais prendre', 'parfait', 'ca va', 'tres bien', 'je prends']], next: 'drink', ex: ["D'accord, le poulet rôti, s'il vous plaît."], en: 'OK, the roast chicken, please.' },
          { kw: [['non', 'autre', 'salade', 'poisson', 'steak']], next: 'drink', ex: ['Non, une salade, plutôt.'], en: 'No, a salad instead.' }
        ] },
        drink: { npc: ['Et comme boisson ?', 'And to drink?'], intents: [
          { kw: [['vin', 'eau', 'carafe', 'biere', 'coca', 'jus', 'verre', 'rien', 'cafe', 'the', 'bouteille', 'pichet', 'limonade']], next: 'later', ex: ["Une carafe d'eau, s'il vous plaît."], en: 'A jug of tap water, please.' }
        ] },
        later: { npc: ['Voilà. Bon appétit !', 'Here you go. Enjoy your meal!'], intents: [
          { kw: [['addition', 'payer', 'combien', 'la note']], next: 'bill', ex: ["L'addition, s'il vous plaît."], en: 'The bill, please.' },
          { kw: [['merci']], next: 'later2', ex: ['Merci beaucoup.'], en: 'Thank you very much.' }
        ] },
        later2: { npc: ['Ça vous a plu ?', 'Did you enjoy it?'], intents: [
          { kw: [['addition', 'payer', 'la note']], next: 'bill', ex: ["Oui, très bon. L'addition, s'il vous plaît."], en: 'Yes, very good. The bill, please.' },
          { kw: [['oui', 'delicieux', 'tres bon', 'excellent', 'super', 'parfait', 'bon']], next: 'later3', ex: ["Oui, c'était délicieux."], en: 'Yes, it was delicious.' }
        ] },
        later3: { npc: ["Je vous apporte l'addition ?", 'Shall I bring you the bill?'], intents: [
          { kw: [['oui', 'addition', 's il vous plait', 'volontiers', 'merci']], next: 'bill', ex: ["Oui, s'il vous plaît."], en: 'Yes, please.' }
        ] },
        bill: { npc: ["Voici l'addition : {bill}. Vous payez par carte ?", "Here's the bill: {billEn}. Paying by card?"], intents: [
          { only: 'overcharge', catches: true, kw: [['erreur', 'cinquante', '52', 'trop', 'pas possible', 'verifier', 'vraiment', 'trente-deux', 'trente deux']], next: 'fixed',
            ex: ["Cinquante-deux euros ? Je crois qu'il y a une erreur."], en: "Fifty-two euros? I think there's a mistake." },
          { kw: [['oui', 'carte', 'espece', 'voila', 'sans contact', 'liquide']], next: 'bye', ex: ['Oui, par carte.'], en: 'Yes, by card.' }
        ] },
        fixed: { only: 'overcharge', npc: ['Oh, excusez-moi. Trente-deux euros, pardon.', 'Oh, excuse me. Thirty-two euros, sorry.'], intents: [
          { kw: PAY.concat([]), alt: THANKS, next: 'bye', ex: ['Merci. Par carte, alors.'], en: 'Thanks. By card, then.' }
        ] },
        bye: { final: true, npc: ['Merci, bonne soirée !', 'Thank you, have a good evening!'], intents: [
          { kw: THANKS, next: null, ex: ["Merci, c'était délicieux. Bonne soirée !"], en: 'Thanks, it was delicious. Have a good evening!' }
        ] }
      }
    },
    {
      id: 'metro', title: 'Métro counter', icon: '🚇', role: 'the agent at a Paris métro station ticket counter',
      goal: 'Buy a Navigo Easy pass with two tickets, then ask which line goes to the Louvre.',
      vars: [
        { lineFr: 'Prenez la ligne 1, direction La Défense. Descendez à Palais-Royal.', lineEn: 'Take line 1 towards La Défense. Get off at Palais-Royal.', ai: 'The way to the Louvre: ligne 1, direction La Défense, get off at Palais-Royal (four stops). The pass plus two tickets is sept euros dix.' },
        { lineFr: 'Prenez la ligne 1, direction La Défense. Attention, la station Palais-Royal est fermée : descendez à Louvre-Rivoli.', lineEn: 'Take line 1 towards La Défense. Careful, Palais-Royal station is closed: get off at Louvre-Rivoli.', closedStation: true, ai: 'The way to the Louvre: ligne 1, direction La Défense, but Palais-Royal station is closed today (fermée): get off at Louvre-Rivoli. The pass plus two tickets is sept euros dix.', note: 'This time Palais-Royal station was closed (fermée): you get off at Louvre-Rivoli.' },
        { lineFr: "Attention, la ligne 1 est interrompue aujourd'hui. Prenez la ligne 7 jusqu'à Palais-Royal.", lineEn: 'Careful, line 1 is out of service today. Take line 7 to Palais-Royal.', strike: true, ai: 'Ligne 1 is interrupted today (interrompue): send the customer on ligne 7 to Palais-Royal. The pass plus two tickets is sept euros dix.', note: 'This time line 1 was out of service (interrompue): line 7 instead.' }
      ],
      start: 'hello',
      nodes: {
        hello: { npc: ['Bonjour, je peux vous aider ?', 'Hello, can I help you?'], intents: [
          { kw: [['navigo', 'passe', 'ticket', 'billet', 'carte']], next: 'total', ex: ["Je voudrais un passe Navigo Easy et deux tickets, s'il vous plaît."], en: "I'd like a Navigo Easy pass and two tickets, please." }
        ] },
        total: { npc: ['Ça fait sept euros dix.', "That's €7.10."], intents: [
          { kw: PAY, next: 'more', ex: ['Voilà, par carte.'], en: 'Here you go, by card.' }
        ] },
        more: { npc: ['Voilà votre passe. Autre chose ?', "Here's your pass. Anything else?"], intents: [
          { kw: [['louvre', 'quelle ligne', 'comment aller', 'pour aller', 'direction', 'musee']], next: 'line', ex: ['Quelle ligne pour aller au Louvre ?'], en: 'Which line to get to the Louvre?' },
          { kw: [['non', 'c est tout', 'rien']], next: 'sure', ex: ['Non, merci.'], en: 'No, thanks.' }
        ] },
        sure: { npc: ['Vous allez où ?', 'Where are you going?'], intents: [
          { kw: [['louvre', 'musee']], next: 'line', ex: ['Au Louvre. Quelle ligne ?'], en: 'To the Louvre. Which line?' }
        ] },
        line: { npc: ['{lineFr}', '{lineEn}'], intents: [
          { only: 'closedStation', catches: true, kw: [['ferme', 'louvre rivoli', 'rivoli', 'autre station']], next: 'yes', ex: ["Louvre-Rivoli ? D'accord."], en: 'Louvre-Rivoli? OK.' },
          { only: 'strike', catches: true, kw: [['greve', 'ligne 7', 'sept', '7', 'interromp', 'ferme', 'travaux']], next: 'yes', ex: ['La ligne 7 ? Merci.'], en: 'Line 7? Thanks.' },
          { kw: [['combien', 'arret', 'c est loin', 'loin', 'temps', 'minutes']], next: 'stops', ex: ["Il y a combien d'arrêts ?"], en: 'How many stops is it?' },
          { kw: THANKS, next: 'bye', ex: ['Merci beaucoup.'], en: 'Thank you very much.' }
        ] },
        yes: { npc: ["Oui, c'est ça.", "Yes, that's right."], intents: [
          { kw: [['combien', 'arret', 'loin']], next: 'stops', ex: ["Il y a combien d'arrêts ?"], en: 'How many stops is it?' },
          { kw: THANKS, next: 'bye', ex: ['Merci beaucoup.'], en: 'Thank you very much.' }
        ] },
        stops: { npc: ['Quatre arrêts.', 'Four stops.'], intents: [
          { kw: THANKS, next: 'bye', ex: ['Parfait. Merci beaucoup.'], en: 'Perfect. Thank you very much.' }
        ] },
        bye: { final: true, npc: ['Je vous en prie. Bonne journée !', "You're welcome. Have a good day!"], intents: [
          { kw: THANKS, next: null, ex: ['Merci, vous aussi.'], en: 'Thanks, you too.' }
        ] }
      }
    },
    {
      id: 'pharmacy', title: 'Pharmacy', icon: '💊', role: 'a pharmacist in a Paris pharmacy',
      goal: 'Get something for a headache, understand how to take it, and pay.',
      vars: [
        { dose: 'Un comprimé toutes les six heures.', doseEn: 'One tablet every six hours.', price: 'trois euros vingt', priceEn: '€3.20', ai: 'Offer paracétamol: one tablet every six hours. A box is trois euros vingt.' },
        { dose: 'Un comprimé toutes les six heures.', doseEn: 'One tablet every six hours.', price: 'trois euros vingt', priceEn: '€3.20', meds: true, ai: 'Before offering anything, ask whether the customer takes other medication. Then paracétamol: one tablet every six hours, trois euros vingt.', note: 'This time the pharmacist asked about other medication first.' },
        { dose: 'Deux comprimés, pas plus de trois fois par jour.', doseEn: 'Two tablets, no more than three times a day.', price: 'trois euros vingt', priceEn: '€3.20', ai: 'Offer paracétamol: two tablets, no more than three times a day. A box is trois euros vingt.', note: 'This time the dose was two tablets, at most three times a day.' }
      ],
      start: 'hello',
      nodes: {
        hello: { npc: ['Bonjour, je vous écoute.', "Hello, what can I do for you?"], intents: [
          { kw: [['tete', 'migraine', 'mal', 'douleur', 'quelque chose']], next: function (v) { return v.meds ? 'meds' : 'offer'; }, ex: ["J'ai mal à la tête. Vous avez quelque chose ?"], en: 'I have a headache. Do you have something?' }
        ] },
        meds: { only: 'meds', npc: ["Vous prenez d'autres médicaments ?", 'Are you taking any other medication?'], intents: [
          { kw: [['non', 'aucun', 'rien']], next: 'offer', ex: ['Non, aucun.'], en: 'No, none.' },
          { kw: [['oui']], next: 'offer', ex: ['Oui, pour la tension.'], en: 'Yes, for blood pressure.' }
        ] },
        offer: { npc: ['Je vous propose du paracétamol. Une boîte ?', "I'd suggest paracetamol. One box?"], intents: [
          { kw: [YES[0].concat(['une boite', 's il vous plait'])], next: 'dose', ex: ["Oui, une boîte, s'il vous plaît."], en: 'Yes, one box, please.' },
          { kw: [['non', 'autre', 'ibuprofene', 'plus fort']], next: 'dose', ex: ["Vous avez de l'ibuprofène ?"], en: 'Do you have ibuprofen?' }
        ] },
        dose: { npc: ['{dose} Ça fait {price}.', "{doseEn} That's {priceEn}."], intents: [
          { catches: true, kw: [['combien de fois', 'par jour', 'heures', 'comprime', 'fois', 'combien de']], next: 'dose2', ex: ['Combien de fois par jour ?'], en: 'How many times a day?' },
          { kw: PAY, next: 'bye', ex: ['Voilà. Merci beaucoup.'], en: 'Here you go. Thank you very much.' }
        ] },
        dose2: { npc: ['{dose}', '{doseEn}'], intents: [
          { kw: PAY.concat([]), alt: THANKS, next: 'bye', ex: ["D'accord, merci. Voilà."], en: 'OK, thanks. Here you go.' }
        ] },
        bye: { final: true, npc: ['Soignez-vous bien. Bonne journée !', 'Take care. Have a good day!'], intents: [
          { kw: THANKS, next: null, ex: ['Merci, au revoir !'], en: 'Thanks, goodbye!' }
        ] }
      }
    },
    {
      id: 'hotel', title: 'Hotel', icon: '🏨', role: 'the receptionist of a small Paris hotel', greet: 'Bonsoir',
      goal: 'Check in under your name and find out when breakfast is.',
      vars: [
        { room: 'trois cent cinq', roomEn: '305', bfast: 'De sept heures à dix heures.', bfastEn: 'From seven to ten.', ai: 'Two nights, room trois cent cinq. Breakfast from seven to ten.' },
        { room: 'cinq cent trois', roomEn: '503', bfast: 'De sept heures et demie à dix heures et demie.', bfastEn: 'From seven thirty to ten thirty.', ai: 'Two nights, room cinq cent trois. Breakfast from seven thirty to ten thirty.', note: 'This time: room 503, breakfast 7:30 to 10:30.' },
        { room: 'trois cent cinq', roomEn: '305', bfast: "Le petit-déjeuner n'est pas compris : c'est quinze euros, de sept heures à dix heures.", bfastEn: "Breakfast isn't included: it's fifteen euros, from seven to ten.", ai: 'Two nights, room trois cent cinq. Breakfast is not included: quinze euros, from seven to ten.', note: "This time breakfast wasn't included (€15)." }
      ],
      start: 'hello',
      nodes: {
        hello: { npc: ['Bonsoir, bienvenue !', 'Good evening, welcome!'], intents: [
          { kw: [['reservation', 'au nom', 'chambre']], next: 'found', ex: ["Bonsoir, j'ai une réservation au nom de Cannon."], en: 'Good evening, I have a reservation under the name Cannon.' }
        ] },
        found: { npc: ['Parfait, deux nuits. Voici votre clé, chambre {room}.', "Perfect, two nights. Here's your key, room {roomEn}."], intents: [
          { kw: [['petit dejeuner', 'petit-dejeuner', 'dejeuner', 'a quelle heure', 'quelle heure']], next: 'bfast', ex: ['À quelle heure est le petit-déjeuner ?'], en: 'What time is breakfast?' },
          { kw: [['quelle chambre', 'quel numero', 'numero', 'etage']], next: 'found', ex: ['Pardon, quelle chambre ?'], en: 'Sorry, which room?' },
          { kw: THANKS, next: 'ask', ex: ['Merci beaucoup.'], en: 'Thank you very much.' }
        ] },
        ask: { npc: ["Je vous en prie. Vous avez besoin d'autre chose ?", "You're welcome. Do you need anything else?"], intents: [
          { kw: [['petit dejeuner', 'petit-dejeuner', 'dejeuner', 'quelle heure']], next: 'bfast', ex: ['À quelle heure est le petit-déjeuner ?'], en: 'What time is breakfast?' }
        ] },
        bfast: { npc: ['{bfast}', '{bfastEn}'], intents: [
          { kw: THANKS, next: 'bye', ex: ['Parfait, merci. Bonne soirée.'], en: 'Perfect, thanks. Have a good evening.' }
        ] },
        bye: { final: true, npc: ['Bonne soirée !', 'Have a good evening!'], intents: [
          { kw: THANKS, next: null, ex: ['Merci, vous aussi.'], en: 'Thanks, you too.' }
        ] }
      }
    },
    {
      id: 'taxi', title: 'Taxi', icon: '🚕', role: 'a Paris taxi driver',
      goal: 'Get to the Gare de Lyon and pay.',
      vars: [
        { time: 'vingt minutes', fare: 'vingt-deux euros', fareEn: '€22', ai: 'Twenty minutes because of traffic; the fare is vingt-deux euros; card is fine.' },
        { time: 'quarante minutes', fare: 'trente-huit euros', fareEn: '€38', ai: 'Heavy traffic: forty minutes; the fare is trente-huit euros; card is fine.', note: 'This time the ride took forty minutes (€38).' },
        { time: 'vingt minutes', fare: 'vingt-deux euros', fareEn: '€22', noCard: true, ai: "Twenty minutes; the fare is vingt-deux euros; your card machine doesn't work today, so cash only.", note: "This time the card machine didn't work: cash only. Paris taxis must take cards; you can insist." }
      ],
      start: 'hello',
      nodes: {
        hello: { npc: ['Bonjour ! Vous allez où ?', 'Hello! Where to?'], intents: [
          { kw: [['gare de lyon', 'gare', 'lyon']], next: 'ok', ex: ["À la gare de Lyon, s'il vous plaît."], en: 'To the Gare de Lyon, please.' }
        ] },
        ok: { npc: ['Il y a des bouchons, il faut compter {time}.', "There's traffic, allow {time}."], intents: [
          { kw: [['carte']], next: function (v) { return v.noCard ? 'nocard' : 'cardok'; }, ex: ['Je peux payer par carte ?'], en: 'Can I pay by card?' },
          { kw: [YES[0].concat(['pas de probleme', 'pas grave'])], next: 'arrive', ex: ["D'accord, pas de problème."], en: 'OK, no problem.' }
        ] },
        cardok: { npc: ['Oui, la carte, ça marche.', 'Yes, card works.'], intents: [
          { kw: [THANKS[0].concat(['oui', 'bien'])], next: 'arrive', ex: ['Parfait, merci.'], en: 'Perfect, thanks.' }
        ] },
        nocard: { only: 'noCard', npc: ["Désolé, le terminal de paiement ne marche pas aujourd'hui. Espèces seulement.", "Sorry, the card terminal isn't working today. Cash only."], intents: [
          { catches: true, kw: [['espece', 'liquide', 'cash', 'd accord', 'ok', 'distributeur', 'pas de probleme']], next: 'arrive', ex: ["D'accord, j'ai des espèces."], en: 'OK, I have cash.' }
        ] },
        arrive: { npc: ['Voilà, on est arrivés. Ça fait {fare}.', "Here we are. That's {fareEn}."], intents: [
          { kw: [['carte', 'sans contact']], next: function (v) { return v.noCard ? 'nocard2' : 'bye'; }, ex: ['Par carte, s\'il vous plaît.'], en: 'By card, please.' },
          { kw: [['voila', 'espece', 'liquide', 'tenez', 'gardez', 'monnaie', 'cash']], next: 'bye', ex: ['Voilà. Gardez la monnaie.'], en: 'Here you go. Keep the change.' }
        ] },
        nocard2: { only: 'noCard', npc: ['Non, espèces seulement, désolé.', 'No, cash only, sorry.'], intents: [
          { catches: true, kw: [['espece', 'liquide', 'voila', 'tenez', 'cash', 'd accord']], next: 'bye', ex: ['Ah oui, pardon. Voilà, en espèces.'], en: 'Oh yes, sorry. Here you go, cash.' }
        ] },
        bye: { final: true, npc: ['Merci, bon voyage !', 'Thanks, have a good trip!'], intents: [
          { kw: THANKS, next: null, ex: ['Merci, au revoir !'], en: 'Thanks, goodbye!' }
        ] }
      }
    },
    {
      id: 'lost', title: 'Lost item', icon: '📱', role: 'the agent at a station information desk',
      goal: 'Report a lost phone: what, where and when.',
      vars: [
        { found: true, ai: 'You have a black iPhone that was handed in this morning; if it matches, give it back.' },
        { found: false, ai: 'Nothing has been handed in yet: ask the customer to fill in a form.', note: 'This time nothing had been handed in: you fill in a form.' }
      ],
      start: 'hello',
      nodes: {
        hello: { npc: ['Bonjour, je peux vous aider ?', 'Hello, can I help you?'], intents: [
          { kw: [['perdu', 'oublie', 'vole', 'perds']], next: 'what', ex: ["J'ai perdu mon téléphone."], en: "I've lost my phone." }
        ] },
        what: { npc: ["Vous l'avez perdu où, et quand ?", 'Where and when did you lose it?'], intents: [
          { kw: [['metro', 'ligne', 'matin', 'hier', 'train', 'gare', 'dans', 'heure', 'tout a l heure', 'bus', 'cafe', 'rer', 'soir', 'midi']], next: 'desc', ex: ['Dans le métro, ligne 1, ce matin.'], en: 'In the métro, line 1, this morning.' }
        ] },
        desc: { npc: ['Il est comment ?', 'What does it look like?'], intents: [
          { kw: [['noir', 'blanc', 'bleu', 'rouge', 'gris', 'rose', 'vert', 'iphone', 'samsung', 'coque', 'telephone']], next: function (v) { return v.found ? 'found' : 'form'; }, ex: ["C'est un iPhone noir."], en: "It's a black iPhone." }
        ] },
        found: { only: 'found', npc: ["On a un iPhone noir ici. C'est le vôtre ?", "We have a black iPhone here. Is it yours?"], intents: [
          { kw: [YES[0].concat(['c est le mien', 'mien', 'merci'])], next: 'bye', ex: ["Oui, c'est le mien ! Merci beaucoup."], en: "Yes, it's mine! Thank you very much." },
          { kw: [['non']], next: 'form', ex: ["Non, ce n'est pas le mien."], en: "No, it's not mine." }
        ] },
        form: { npc: ["Désolé, rien pour l'instant. Remplissez ce formulaire, s'il vous plaît.", 'Sorry, nothing yet. Please fill in this form.'], intents: [
          { kw: [YES[0].concat(THANKS[0], ['formulaire', 'voila'])], next: 'bye', ex: ["D'accord. Voilà, merci."], en: 'OK. Here you go, thanks.' }
        ] },
        bye: { final: true, npc: ['Bonne journée, et bon courage !', 'Have a good day, and good luck!'], intents: [
          { kw: THANKS, next: null, ex: ['Merci, au revoir.'], en: 'Thanks, goodbye.' }
        ] }
      }
    }
  ];

  var MISS = ["Pardon ? Je n'ai pas compris.", "Sorry? I didn't understand."];
  var HELLO_BACK = ['Bonjour ! Je vous écoute.', "Hello! I'm listening."];
  var HELLO_BACK_EVENING = ['Bonsoir ! Je vous écoute.', "Good evening! I'm listening."];
  // The reply to a bare greeting: Bonsoir for the evening scenes (greet: 'Bonsoir').
  function helloBack(sc) {
    var h = sc && sc.greet === 'Bonsoir' ? HELLO_BACK_EVENING : HELLO_BACK;
    return { fr: h[0], en: h[1] };
  }
  var CLARIFY = [['pardon', 'repet', 'comprend', 'compris', 'lentement', 'comment', 'quoi', 'encore une fois', 'redire']];
  var GREET = [['bonjour', 'bonsoir', 'salut']];

  // ── Text helpers ──────────────────────────────────────────────
  function fold(s) {
    return ' ' + String(s || '').toLowerCase().replace(/[’‘ʼ`´']/g, ' ').replace(/œ/g, 'oe').replace(/æ/g, 'ae')
      .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  }
  function hasKw(f, kw) { return f.indexOf(' ' + fold(kw).trim()) > -1; }
  function groupsHit(f, groups) {
    return !!(groups && groups.length) && groups.every(function (g) { return g.some(function (k) { return hasKw(f, k); }); });
  }
  function fill(s, v) { return String(s).replace(/\{(\w+)\}/g, function (m, k) { return v && v[k] != null ? v[k] : m; }); }

  function get(id) { for (var i = 0; i < SCENES.length; i++) if (SCENES[i].id === id) return SCENES[i]; return null; }
  function list() { return SCENES.map(function (s) { return { id: s.id, title: s.title, icon: s.icon, goal: s.goal, variants: s.vars.length }; }); }
  function onFor(x, v) { return !x.only || !!v[x.only]; }
  function intentsFor(node, v) { return (node.intents || []).filter(function (it) { return onFor(it, v); }); }
  function nextOf(it, v) { return typeof it.next === 'function' ? it.next(v) : it.next; }

  // ── Engine ────────────────────────────────────────────────────
  function start(id, variant) {
    var sc = get(id);
    if (!sc) throw new Error('unknown scene ' + id);
    var vi = ((variant | 0) % sc.vars.length + sc.vars.length) % sc.vars.length;
    var st = { scene: id, variant: vi, node: sc.start, done: false, turns: [], misses: 0, nodeMisses: 0, clarify: 0, hints: 0, caught: false, saidHello: null, struggled: [], nudges: [] };
    st.turns.push({ who: 'npc', fr: line(st).fr, en: line(st).en, node: st.node });
    return st;
  }
  function vars(st) { var sc = get(st.scene); return sc.vars[st.variant]; }
  function line(st) {
    var sc = get(st.scene), node = sc.nodes[st.node], v = vars(st);
    return { fr: fill(node.npc[0], v), en: fill(node.npc[1], v) };
  }
  // The reply to suggest at this point: the first example of the first intent on.
  function hint(st) {
    var sc = get(st.scene), node = sc.nodes[st.node], v = vars(st);
    var its = intentsFor(node, v).filter(function (it) { return !it.catches; });
    var it = its[0] || intentsFor(node, v)[0];
    if (!it) return null;
    var first = !st.turns.some(function (t) { return t.who === 'you'; });
    if (first && !groupsHit(fold(it.ex[0]), GREET)) return { fr: 'Bonjour. ' + it.ex[0], en: 'Hello. ' + it.en };
    return { fr: it.ex[0], en: it.en };
  }
  function matchIntent(typed, it) {
    var g = SR && SR.gradeAnswer;
    for (var i = 0; g && i < it.ex.length; i++) {
      var r = g(typed, it.ex[i], { lang: 'fr' });
      if (r.ok) return { exact: true, nudge: !!r.nudge, expected: r.expected };
    }
    var f = fold(typed);
    if (groupsHit(f, it.kw) || groupsHit(f, it.alt)) return { exact: false };
    return null;
  }
  // One turn. Returns { kind: 'intent'|'clarify'|'hello'|'miss', npc: {fr,en}, done, slow }.
  function respond(st, typed) {
    if (st.done) return { kind: 'done', done: true };
    var said = String(typed || '').trim().slice(0, 300);
    if (!said) return null;
    var sc = get(st.scene), node = sc.nodes[st.node], v = vars(st);
    var f = fold(said);
    var firstTurn = !st.turns.some(function (t) { return t.who === 'you'; });
    if (firstTurn) st.saidHello = groupsHit(f, GREET);
    st.turns.push({ who: 'you', fr: said, node: st.node });
    var its = intentsFor(node, v), hit = null, m = null;
    for (var i = 0; i < its.length && !hit; i++) { m = matchIntent(said, its[i]); if (m) hit = its[i]; }
    var out;
    if (hit) {
      if (hit.catches) st.caught = true;
      if (m.nudge) st.nudges.push({ said: said, fr: m.expected, en: hit.en });
      if (st.nodeMisses > 0 || st.hintShown) pushStruggle(st, hit);
      st.nodeMisses = 0; st.hintShown = false;
      var nx = nextOf(hit, v);
      if (node.final || !nx) {
        st.done = true;
        return { kind: 'intent', done: true, npc: null };
      }
      st.node = nx;
      out = { kind: 'intent', npc: line(st), done: false };
    } else if (node.final) {
      st.done = true;
      return { kind: 'intent', done: true, npc: null };
    } else if (groupsHit(f, CLARIFY)) {
      st.clarify++;
      out = { kind: 'clarify', npc: line(st), slow: true, done: false };
    } else if (groupsHit(f, GREET) && f.trim().split(' ').length <= 3) {
      out = { kind: 'hello', npc: helloBack(sc), done: false };
    } else {
      st.misses++; st.nodeMisses++;
      out = { kind: 'miss', npc: { fr: MISS[0], en: MISS[1] }, done: false, showHint: st.nodeMisses >= 2 };
    }
    st.turns.push({ who: 'npc', fr: out.npc.fr, en: out.npc.en, node: st.node, kind: out.kind });
    return out;
  }
  function pushStruggle(st, it) {
    if (!st.struggled.some(function (s) { return s.fr === it.ex[0]; })) st.struggled.push({ fr: it.ex[0], en: it.en });
  }
  function useHint(st) { st.hints++; st.hintShown = true; return hint(st); }
  // Changed fact on replay: the next variant.
  function nextVariant(id, prev) { var sc = get(id); return ((prev | 0) + 1) % sc.vars.length; }

  // Debrief: corrections (lines he needed a hint or a retry for, and accent
  // slips) become review cards in the app.
  function debrief(st) {
    var v = vars(st), cards = [];
    var seen = {};
    st.struggled.concat(st.nudges).forEach(function (c) {
      var k = fold(c.fr);
      if (seen[k]) return; seen[k] = 1;
      cards.push({ fr: c.fr, en: c.en, said: c.said || null, why: c.said ? 'accents' : 'retry' });
    });
    var notes = [];
    if (st.saidHello === false) notes.push('Start with Bonjour (Bonsoir after about 6 pm).');
    if (v.note && !st.caught) notes.push(v.note);
    return { done: st.done, turns: st.turns.filter(function (t) { return t.who === 'you'; }).length, clarify: st.clarify, hints: st.hints, misses: st.misses, caught: st.caught, corrections: cards, notes: notes };
  }

  // Every concrete line the other side can say (all variants), for audio.
  function allNpcLines() {
    var out = [MISS[0], HELLO_BACK[0], HELLO_BACK_EVENING[0]], seen = {};
    SCENES.forEach(function (sc) {
      sc.vars.forEach(function (v) {
        Object.keys(sc.nodes).forEach(function (k) {
          var n = sc.nodes[k];
          if (onFor(n, v)) out.push(fill(n.npc[0], v));
        });
      });
    });
    return out.filter(function (s) { if (seen[s]) return false; seen[s] = 1; return true; });
  }
  // What the AI partner gets: who it is, the goal, this variant's fact and
  // the scene's words (its lines and the expected replies).
  function aiBrief(id, variant) {
    var sc = get(id);
    if (!sc) return null;
    var vi = ((variant | 0) % sc.vars.length + sc.vars.length) % sc.vars.length, v = sc.vars[vi];
    var words = [];
    Object.keys(sc.nodes).forEach(function (k) {
      var n = sc.nodes[k];
      if (!onFor(n, v)) return;
      words.push(fill(n.npc[0], v));
      intentsFor(n, v).forEach(function (it) { words.push(it.ex[0]); });
    });
    return { id: sc.id, title: sc.title, role: sc.role, goal: sc.goal, fact: v.ai || '', opening: fill(sc.nodes[sc.start].npc[0], v), openingEn: fill(sc.nodes[sc.start].npc[1], v), words: words };
  }

  var API = { SCENES: SCENES, list: list, get: get, start: start, respond: respond, hint: hint, useHint: useHint, line: line,
    debrief: debrief, nextVariant: nextVariant, allNpcLines: allNpcLines, aiBrief: aiBrief, fold: fold, matchIntent: matchIntent };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.CLSCENES = API;
})(typeof window !== 'undefined' ? window : globalThis);
