const { Games } = require('@openhud/api');
const { suits, ranks, products, flushes, unique5, values } = require('poker-hand-evaluator/src/arrays');

const cardInt = (card) => {
    const [order, prime] = ranks.get(card[0]);
    const suit = suits.get(card[1]);
    return prime | (order << 8) | suit | (1 << (16 + order));
}

const findIt = (key) => {
    let low = 0;
    let high = 4887;
    let mid;

    while (low <= high) {
        // Divide by two
        mid = (high + low) >> 1;
        if (key < products[mid]) {
            high = mid - 1;
        } else if (key > products[mid]) {
            low = mid + 1;
        } else {
            return mid;
        }
    }
    throw new Error('Impossible hand');
};

/**
 * Credit to Cactus Kev's algorithm
 * http://suffe.cool/poker/code/pokerlib.c
 */
const evalHand = (cards) => {
    const q =
        (cards[0] | cards[1] | cards[2] | cards[3] | cards[4]) >> 16;

    // Check for flushes and straight flushes
    if (cards[0] & cards[1] & cards[2] & cards[3] & cards[4] & 0xF000) {
        // TODO: If flushes[q] === 0 it means the hand is not correct
        // We could throw an error here
        return flushes[q];
    }

    // Check for straights and high card hands
    const s = unique5[q];
    if (s) {
        return s;
    }

    // let's do it the hard way
    const l =
        (cards[0] & 0xFF) *
        (cards[1] & 0xFF) *
        (cards[2] & 0xFF) *
        (cards[3] & 0xFF) *
        (cards[4] & 0xFF);
    const m = findIt(l);
    return values[m];
};

//////////

const Combinatorics = require('js-combinatorics');
const Subtract = require('array-subtract');

const subtract = new Subtract((a, b) => { return a === b });

const toInternalCard = str => cardInt(str.toUpperCase());

const allSuits = ['s', 'h', 'c', 'd'];
const allRanks = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
const deck = Combinatorics.cartesianProduct(allRanks, allSuits).toArray().map(x => `${x[0]}${x[1]}`).map(toInternalCard);


const calcScore = ({ community, hole }) => {
    let bestScore = Number.MAX_SAFE_INTEGER;

    const communityCmb = Combinatorics.bigCombination(community, 3);
    let communityPart;
    while (communityPart = communityCmb.next()) {
        const holeCmb = Combinatorics.bigCombination(hole, 2);
        let holePart;
        while (holePart = holeCmb.next()) {
            const score = evalHand(communityPart.concat(holePart));
            bestScore = Math.min(bestScore, score);
        }
    }

    return bestScore;
};

const existsBetterHandScore = ({ community, discard = [], score }) => {
    const potentialHole = subtract.sub(deck, community.concat(discard));

    const communityCmb = Combinatorics.bigCombination(community, 3);
    let communityPart;
    while (communityPart = communityCmb.next()) {
        const holeCmb = Combinatorics.bigCombination(potentialHole, 2);
        let holePart;
        while (holePart = holeCmb.next()) {
            const potentialScore = evalHand(communityPart.concat(holePart));
            if (potentialScore < score) {
                return true;
            }
        }
    }

    return false;
};

const calcNutsPercentageRiver = ({ community, hole, discard }) => {
    const hiddenBurnt = hole.concat(discard);

    const score = calcScore({ community, hole });
    const nuts = (!existsBetterHandScore({ community, discard: hiddenBurnt, score })) ? 1 : 0;

    return { scenarios: 1, nuts };
};

const calcNutsPercentageTurn = ({ community, hole, discard = [] }) => {
    let scenarios = 0;
    let nuts = 0;

    const hiddenBurnt = hole.concat(discard);
    const outs = subtract.sub(deck, community.concat(hiddenBurnt));

    const outsCmb = Combinatorics.bigCombination(outs, 1);
    let outsPart;
    while (outsPart = outsCmb.next()) {
        ++scenarios;
        const board = community.concat(outsPart);

        const score = calcScore({ community: board, hole });
        if (!existsBetterHandScore({ community: board, discard: hiddenBurnt, score })) {
            ++nuts;
        }
    }

    return { scenarios, nuts };
};

const calcNutsPercentageFlop = ({ community, hole, discard = [] }) => {
    let scenarios = 0;
    let nuts = 0;

    const hiddenBurnt = hole.concat(discard);
    const outs = subtract.sub(deck, community.concat(hiddenBurnt));

    const outsCmb = Combinatorics.bigCombination(outs, 2);
    let outsPart;
    while (outsPart = outsCmb.next()) {
        ++scenarios;
        const board = community.concat(outsPart);

        const score = calcScore({ community: board, hole });
        if (!existsBetterHandScore({ community: board, discard: hiddenBurnt, score })) {
            ++nuts;
        }
    }

    return { scenarios, nuts };
};

//////////

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const functions = require('firebase-functions');


const app = express()
app.use(cors({
    origin: true,
    maxAge: 86400
}));
app.use(bodyParser.json());

const parseCards = str => str ? str.split(',').map(toInternalCard) : [];

app.get('/v1/omaha/river', (request, response) => {
    const { hole, community, discard } = request.query;
    // TODO: validate arguments

    const holeCards = parseCards(hole);
    const communityCards = parseCards(community);
    const discardCards = parseCards(discard);

    const result = calcNutsPercentageRiver({
        community: communityCards,
        hole: holeCards,
        discard: discardCards
    });

    response.status(200).send(result);
});

app.get('/v1/omaha/turn', (request, response) => {
    const { hole, community, discard } = request.query;
    // TODO: validate arguments

    const holeCards = parseCards(hole);
    const communityCards = parseCards(community);
    const discardCards = parseCards(discard);

    const result = calcNutsPercentageTurn({
        community: communityCards,
        hole: holeCards,
        discard: discardCards
    });

    response.status(200).send(result);
});

app.get('/v1/omaha/flop', (request, response) => {
    const { hole, community, discard } = request.query;
    // TODO: validate arguments

    const holeCards = parseCards(hole);
    const communityCards = parseCards(community);
    const discardCards = parseCards(discard);

    const result = calcNutsPercentageFlop({
        community: communityCards,
        hole: holeCards,
        discard: discardCards
    });

    response.status(200).send(result);
});

app.get('/hud/omaha/river', (request, response) => {
    const { data } = request.query;
    const { players, community } = JSON.parse(data);

    const result = { players: {} };
    for (let [playerName, hole] of Object.entries(players)) {
        let discard = [];
        for (let [otherPlayerName, otherHole] of Object.entries(players)) {
            if (playerName !== otherPlayerName) {
                discard = discard.concat(otherHole);
            }
        }
        const { nuts } = calcNutsPercentageRiver({ community, hole, discard });
        result.players[playerName] = `[river] ${nuts ? 'THE NUTS! :)' : 'Not the nuts :('}`;
    }

    response.setHeader('Cache-Control', 'public, max-age=300');
    response.status(200).send(result);
});

app.get('/hud/omaha/turn', (request, response) => {
    const { data } = request.query;
    const { players, community } = JSON.parse(data);

    const result = { players: {} };
    for (let [playerName, hole] of Object.entries(players)) {
        let discard = [];
        for (let [otherPlayerName, otherHole] of Object.entries(players)) {
            if (playerName !== otherPlayerName) {
                discard = discard.concat(otherHole);
            }
        }
        const { scenarios, nuts } = calcNutsPercentageTurn({ community, hole, discard });
        const p = Math.round(10000 * nuts / scenarios) / 100;
        result.players[playerName] = `[turn] River nuts = ${p}%`;
    }

    response.setHeader('Cache-Control', 'public, max-age=300');
    response.status(200).send(result);
});

app.get('/hud/omaha/flop', (request, response) => {
    const { data } = request.query;
    const { players, community } = JSON.parse(data);

    const result = { players: {} };
    for (let [playerName, hole] of Object.entries(players)) {
        let discard = [];
        for (let [otherPlayerName, otherHole] of Object.entries(players)) {
            if (playerName !== otherPlayerName) {
                discard = discard.concat(otherHole);
            }
        }
        const { scenarios, nuts } = calcNutsPercentageFlop({ community, hole, discard });
        const p = Math.round(10000 * nuts / scenarios) / 100;
        result.players[playerName] = `[flop] River nuts = ${p}%`;
    }

    response.setHeader('Cache-Control', 'public, max-age=300');
    response.status(200).send(result);
});

const baseUrl = 'https://us-central1-my-random-scripts.cloudfunctions.net/openhud-nuts';

app.post('/', (request, response) => {
    const { game, bb, seats, community } = request.body;

    if (game.type !== Games.OmahaHoldem) {
        response.status(200).send({ players: {} });
        return;
    }

    const players = {};
    seats.forEach(seat => {
        const { playerName, isMe, isFolded, stack, pot, cards } = seat;
        if (cards.length > 0) {
            players[playerName] = cards.map(toInternalCard);
        }
    });

    switch (community.length) {
        case 5:
            {
                const data = JSON.stringify({ players, community: community.map(toInternalCard) });
                const url = `${baseUrl}/hud/omaha/river?data=${encodeURIComponent(data)}`;
                response.redirect(303, url);
            }
            break;
        case 4:
            {
                const data = JSON.stringify({ players, community: community.map(toInternalCard) });
                const url = `${baseUrl}/hud/omaha/turn?data=${encodeURIComponent(data)}`;
                response.redirect(303, url);
            }
            break;
        case 3:
            {
                const data = JSON.stringify({ players, community: community.map(toInternalCard) });
                const url = `${baseUrl}/hud/omaha/flop?data=${encodeURIComponent(data)}`;
                response.redirect(303, url);
            }
            break;
        default:
            response.status(200).send({ players: {} });
            break;
    }
});

const metadata = {
    title: 'Nuts Percentage Calculator',
    description: 'Calculates probability of having the best possible hand on the river (on flop and turn).',
    games: [{
        type: Games.OmahaHoldem,
        bet: '*',
        format: '*'
    }],
    author: {
        name: 'Open HUD',
        url: 'https://github.com/OpenHUD'
    }
};

app.get('/', (request, response) => {
    response.status(200).send(metadata);
});


module.exports = {
    openhud: functions.https.onRequest(app)
};