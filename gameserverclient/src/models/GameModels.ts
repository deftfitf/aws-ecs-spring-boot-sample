import {Card, GameEvent} from "../proto/GameServerService_pb";
import {scoreBoardAdapter, snapshotToGameState} from "./GameModelAdapter";

export type ScoreBoard = Map<string, { score: number, bonus: number }>[];

export enum DeckType {
  STANDARD,
  EXPANSION
}

export type GameRule = {
  readonly roomSize: number;
  readonly nOfRounds: number;
  readonly deckType: DeckType;
}

export class GameEventStack {

  private eventStack: string[] = [];

  getGameEvents: () => string[] = () => {
    return [...this.eventStack];
  };

  appendGameEvent: (gameEvent: GameEvent) => void = (gameEvent) => {
    this.eventStack.push(this.convertEventToString(gameEvent));
  }

  private convertEventToString = (gameEvent: GameEvent) => {
    switch (gameEvent.getEventCase()) {
      default:
        return `${gameEvent.getEventCase()}イベントが発生しました`
    }
  }

}

export interface GameState {

  getGameEvents(): string[];

  getDeck(): Map<string, Card>;

  applyEvent(event: GameEvent): GameState;

}

const createBiddingPhase = (
deck: Map<string, Card>,
gameRoomId: string,
myPlayerId: string,
eventStack: GameEventStack,
gameRule: GameRule,
roomOwnerId: string,
dealerId: string,
scoreBoard: ScoreBoard,
event: GameEvent.RoundStarted
) => {
  const biddingPlayers = event.getJoinedPlayersList()
  .map(player => ({
    playerId: player.getPlayerId(),
    isBid: false,
    card: player.getCard()
  }));

  return new BiddingPhase(
  deck,
  gameRoomId,
  myPlayerId,
  eventStack, gameRule,
  roomOwnerId, dealerId,
  event.getDeck(), biddingPlayers,
  event.getCardList(),
  null, event.getRound(),
  scoreBoard
  );
}

export class WaitForInitialize implements GameState {

  constructor(
  private readonly gameRoomId: string,
  private readonly myPlayerId: string,
  ) {
  }

  getDeck(): Map<string, Card> {
    throw new Error("Method not implemented.");
  }

  applyEvent(event: GameEvent): GameState {
    switch (event.getEventCase()) {
      case GameEvent.EventCase.GAME_SNAPSHOT:
        const snapshot = event.getGameSnapshot()!;
        return snapshotToGameState(this.myPlayerId, snapshot.getGameState()!);

      default:
        return this;
    }
  }

  getGameEvents(): string[] {
    return [];
  }

}

export class StartPhase implements GameState {

  constructor(
  readonly deck: Map<string, Card>,
  readonly gameRoomId: string,
  readonly myPlayerId: string,
  readonly eventStack: GameEventStack,
  readonly rule: GameRule,
  readonly roomOwnerId: string,
  readonly playerIds: string[]
  ) {
  }

  applyEvent(event: GameEvent): GameState {
    this.eventStack.appendGameEvent(event);

    switch (event.getEventCase()) {
      case GameEvent.EventCase.A_PLAYER_JOINED:
        const aPlayerJoined = event.getAPlayerJoined()!;

        if (!this.playerIds.includes(aPlayerJoined.getPlayerId())) {
          this.playerIds.push(aPlayerJoined.getPlayerId())
        }
        return new StartPhase(
        this.deck,
        this.gameRoomId,
        this.myPlayerId,
        this.eventStack, this.rule, this.roomOwnerId,
        this.playerIds
        );

      case GameEvent.EventCase.A_PLAYER_LEFT:
        const aPlayerLeft = event.getAPlayerLeft()!;

        return new StartPhase(
        this.deck,
        this.gameRoomId,
        this.myPlayerId,
        this.eventStack, this.rule, this.roomOwnerId,
        this.playerIds.filter(id => aPlayerLeft.getPlayerId() !== id)
        );

      case GameEvent.EventCase.ROUND_STARTED:
        return createBiddingPhase(
        this.deck,
        this.gameRoomId,
        this.myPlayerId, this.eventStack, this.rule,
        this.roomOwnerId, this.roomOwnerId, [], event.getRoundStarted()!
        );

      default:
        return this;
    }
  }

  getGameEvents = this.eventStack.getGameEvents;

  isMeRoomOwner = this.roomOwnerId == this.myPlayerId;

  canStartGame = this.playerIds.length >= 2;

  getDeck(): Map<string, Card> {
    return this.deck;
  }

}

export type BiddingPlayer = {
  readonly playerId: string;
  readonly isBid: boolean;
  readonly card: number;
}

export class BiddingPhase implements GameState {

  constructor(
  readonly deckMap: Map<string, Card>,
  readonly gameRoomId: string,
  readonly myPlayerId: string,
  readonly eventStack: GameEventStack,
  readonly rule: GameRule,
  readonly roomOwnerId: string,
  readonly dealerId: string,
  readonly deck: number,
  readonly players: BiddingPlayer[],
  readonly myCardIds: string[],
  public myBid: number | null,
  readonly round: number,
  readonly scoreBoard: ScoreBoard
  ) {
  }

  applyEvent(event: GameEvent): GameState {
    this.eventStack.appendGameEvent(event);

    switch (event.getEventCase()) {
      case GameEvent.EventCase.A_PLAYER_BID_DECLARED:
        const bidDeclared = event.getAPlayerBidDeclared()!;
        if (bidDeclared.getPlayerId() == this.myPlayerId) {
          this.myBid = bidDeclared.getBidDeclared();
        }
        const idx = this.players.findIndex(p => p.playerId == bidDeclared.getPlayerId());
        this.players[idx] = {
          ...this.players[idx],
          isBid: true
        }

        return Object.create(this);

      case GameEvent.EventCase.TRICK_STARTED:
        const trickStarted = event.getTrickStarted()!;
        const trickingPlayers = trickStarted.getBidPlayersList()
        .map<TrickingPlayer>(joined => ({
          playerId: joined.getPlayerId(),
          declaredBid: joined.getBid(),
          tookTrick: 0,
          card: joined.getCard(),
          tookBonus: 0,
        }));

        return new TrickPhase(
        this.deckMap,
        this.gameRoomId, this.myPlayerId,
        this.eventStack, this.rule, this.roomOwnerId, this.round, this.dealerId, this.dealerId,
        trickingPlayers, this.myCardIds, this.deck,
        0, null, [], 1, this.scoreBoard
        );

      default:
        return this;
    }
  }

  getGameEvents = this.eventStack.getGameEvents;

  getDeck(): Map<string, Card> {
    return this.deckMap;
  }

}

export type TrickingPlayer = {
  readonly playerId: string;
  readonly declaredBid: number;
  readonly tookTrick: number;
  readonly card: number;
  readonly tookBonus: number
}

export enum MustFollow {
  GREEN,
  YELLOW,
  PURPLE,
  BLACK
}

export class TrickPhase implements GameState {

  constructor(
  readonly deckMap: Map<string, Card>,
  readonly gameRoomId: string,
  readonly myPlayerId: string,
  readonly eventStack: GameEventStack,
  readonly rule: GameRule,
  readonly roomOwnerId: string,
  public round: number,
  public dealerId: string,
  public nextPlayerId: string,
  readonly players: TrickingPlayer[],
  public myCardIds: string[],
  readonly deck: number,
  readonly stack: number,
  readonly mustFollow: MustFollow | null,
  public field: { playerId: string, card: Card }[],
  readonly trick: number,
  readonly scoreBoard: ScoreBoard,
  ) {
  }

  applyEvent(event: GameEvent): GameState {
    this.eventStack.appendGameEvent(event);

    switch (event.getEventCase()) {
      case GameEvent.EventCase.A_PLAYER_TRICK_PLAYED:
        const played = event.getAPlayerTrickPlayed()!;

        const idx = this.players.findIndex(player => player.playerId == played.getPlayerId());
        this.players[idx] = {
          ...this.players[idx],
          card: this.players[idx].card - 1,
        }

        let myCards = this.myCardIds;
        if (played.getPlayerId() == this.myPlayerId) {
          myCards = this.myCardIds.filter(cardId => cardId != played.getPlayedCard()!.getCardId());
        }

        const nextPlayerId = this.players[(idx + 1) % this.players.length].playerId;

        return new TrickPhase(
        this.deckMap,
        this.gameRoomId,
        this.myPlayerId,
        this.eventStack,
        this.rule,
        this.roomOwnerId,
        this.round,
        this.dealerId,
        nextPlayerId,
        this.players,
        myCards,
        this.deck,
        this.stack,
        this.mustFollow,
        [...this.field, {
          playerId: played.getPlayerId(),
          card: played.getPlayedCard()!
        }],
        this.trick,
        this.scoreBoard
        );

      case GameEvent.EventCase.NEXT_TRICK_LEAD_PLAYER_CHANGEABLE_NOTICE:
        const nextTrickLeadPlayerChangeableNotice = event.getNextTrickLeadPlayerChangeableNotice()!;

        return new NextTrickLeadPlayerChangingPhase(this, nextTrickLeadPlayerChangeableNotice.getPlayerId());

      case GameEvent.EventCase.HAND_CHANGE_AVAILABLE_NOTICE:
        const handChangeAvailableNotice = event.getHandChangeAvailableNotice()!;

        return new HandChangeWaitingPhase(this,
        handChangeAvailableNotice.getPlayerId(),
        handChangeAvailableNotice.getDrawCardsList());

      case GameEvent.EventCase.FUTURE_PREDICATE_AVAILABLE:
        const futurePredicateNotice = event.getFuturePredicateAvailable()!;
        const targetPlayerId = futurePredicateNotice.getPlayerId();

        return new FuturePredicateWaitingPhase(this,
        targetPlayerId,
        futurePredicateNotice.getDeckCardList());

      case GameEvent.EventCase.DECLARE_BID_CHANGE_AVAILABLE:
        const declareBidChangeAvailable = event.getDeclareBidChangeAvailable()!;

        return new BidDeclareChangeWaitingPhase(this,
        declareBidChangeAvailable.getPlayerId());

      case GameEvent.EventCase.A_PLAYER_WON: {
        const aAPlayerWon = event.getAPlayerWon()!;
        const idx = this.players.findIndex(player => player.playerId == aAPlayerWon.getWinnerId());
        this.players[idx] = {
          ...this.players[idx],
          tookTrick: this.players[idx].tookTrick + 1,
          tookBonus: this.players[idx].tookBonus + aAPlayerWon.getTrickBonus()
        }
        this.dealerId = aAPlayerWon.getWinnerId();
        this.nextPlayerId = aAPlayerWon.getWinnerId();
        this.field = [];

        return Object.create(this);
      }

      case GameEvent.EventCase.ALL_RAN_AWAY:
        const allRanAway = event.getAllRanAway()!;

        this.dealerId = allRanAway.getWinnerId();
        this.nextPlayerId = allRanAway.getWinnerId();
        this.field = [];

        return Object.create(this);

      case GameEvent.EventCase.KRAKEN_APPEARED:
        const krakenAppeared = event.getKrakenAppeared()!;

        this.dealerId = krakenAppeared.getMustHaveWon();
        this.nextPlayerId = krakenAppeared.getMustHaveWon();
        this.field = [];

        return Object.create(this);

      case GameEvent.EventCase.ROUND_FINISHED:
        const roundFinished = event.getRoundFinished()!;
        const roundScoreMap = new Map<string, { score: number, bonus: number }>();
        roundFinished.getRoundScoreMap().forEach((score, key) => {
          roundScoreMap.set(key, {
            score: score.getScore(),
            bonus: score.getBonus(),
          });
        });

        this.scoreBoard.push(roundScoreMap);
        this.field = [];

        return new TrickPhase(
        this.deckMap,
        this.gameRoomId,
        this.myPlayerId,
        this.eventStack,
        this.rule,
        this.roomOwnerId,
        this.round,
        this.dealerId,
        this.nextPlayerId,
        this.players,
        this.myCardIds,
        this.deck,
        this.stack,
        this.mustFollow,
        this.field,
        this.trick,
        this.scoreBoard
        );

      case GameEvent.EventCase.ROUND_STARTED:
        return createBiddingPhase(
        this.deckMap,
        this.gameRoomId,
        this.myPlayerId, this.eventStack, this.rule,
        this.roomOwnerId, this.dealerId, this.scoreBoard, event.getRoundStarted()!
        );

      case GameEvent.EventCase.GAME_FINISHED:
        const gameFinished = event.getGameFinished()!;
        const gameScore: ScoreBoard = scoreBoardAdapter(gameFinished.getScoreBoard()!);

        return new FinishedPhase(
        this.deckMap,
        this.gameRoomId,
        this.myPlayerId, this.roomOwnerId, this.eventStack, this.rule,
        gameFinished.getGameWinnerId(), gameScore
        );

      default:
        return this;
    }
  }

  getGameEvents = this.eventStack.getGameEvents;

  changeLeadPlayerId = (newLeadPlayerId: string) => this.dealerId = newLeadPlayerId;

  addMyCards = (cards: string[]) => this.myCardIds.push(...cards);

  isMyTurn = () => this.myPlayerId === this.nextPlayerId;

  changeBidDeclare = (playerId: string, newBid: number) => {
    const idx = this.players.findIndex(player => player.playerId == playerId);
    this.players[idx] = {
      ...this.players[idx],
      declaredBid: newBid
    }
  }

  getPlayerOf = (playerId: string) =>
  this.players.find(p => p.playerId == playerId);

  getDealerId = () => this.dealerId;

  getMyCardIds = () => [...this.myCardIds];

  getDeck(): Map<string, Card> {
    return this.deckMap;
  }

}

export class NextTrickLeadPlayerChangingPhase implements GameState {

  constructor(
  readonly gameState: TrickPhase,
  readonly changingPlayerId: string,
  ) {
  }

  applyEvent(event: GameEvent): GameState {
    this.gameState.eventStack.appendGameEvent(event);

    switch (event.getEventCase()) {
      case GameEvent.EventCase.NEXT_TRICK_LEAD_PLAYER_CHANGED:
        const changed = event.getNextTrickLeadPlayerChanged()!;
        this.gameState.changeLeadPlayerId(changed.getNewLeadPlayerId());

        return this.gameState;

      default:
        return this;
    }
  }

  getGameEvents = this.gameState.eventStack.getGameEvents;

  getDeck(): Map<string, Card> {
    return this.gameState.deckMap;
  }

}

export class HandChangeWaitingPhase implements GameState {

  constructor(
  readonly gameState: TrickPhase,
  readonly changingPlayerId: string,
  readonly drawCardIds?: string[],
  ) {
  }

  applyEvent(event: GameEvent): GameState {
    this.gameState.eventStack.appendGameEvent(event);

    switch (event.getEventCase()) {
      case GameEvent.EventCase.PLAYER_HAND_CHANGED:
        const handChanged = event.getPlayerHandChanged()!;

        if (handChanged.getPlayerId() == this.gameState.myPlayerId) {
          const myNewCards = [...this.gameState.myCardIds, ...this.drawCardIds!].filter(cardId => {
            return !handChanged.getReturnCardsList().includes(cardId);
          });
          return new TrickPhase(
          this.gameState.deckMap,
          this.gameState.gameRoomId,
          this.gameState.myPlayerId,
          this.gameState.eventStack,
          this.gameState.rule,
          this.gameState.roomOwnerId,
          this.gameState.round,
          this.gameState.dealerId,
          this.gameState.nextPlayerId,
          this.gameState.players,
          myNewCards,
          this.gameState.deck,
          this.gameState.stack,
          this.gameState.mustFollow,
          this.gameState.field,
          this.gameState.trick,
          this.gameState.scoreBoard
          );
        }

        return this;

      default:
        return this;
    }
  }

  getGameEvents = this.gameState.eventStack.getGameEvents;

  getDeck(): Map<string, Card> {
    return this.gameState.deckMap;
  }
}

export class FuturePredicateWaitingPhase implements GameState {

  constructor(
  readonly gameState: TrickPhase,
  readonly predicatingPlayerId: string,
  readonly deckCards: string[],
  ) {
  }

  applyEvent(event: GameEvent): GameState {
    switch (event.getEventCase()) {
      case GameEvent.EventCase.FUTURE_PREDICATED:
        return Object.create(this.gameState);

      default:
        return this;
    }
  }

  getGameEvents = this.gameState.eventStack.getGameEvents;

  getDeck(): Map<string, Card> {
    return this.gameState.deckMap;
  }

}

export class BidDeclareChangeWaitingPhase implements GameState {

  constructor(
  readonly gameState: TrickPhase,
  readonly changingPlayerId: string
  ) {
  }

  applyEvent(event: GameEvent): GameState {
    this.gameState.eventStack.appendGameEvent(event);

    switch (event.getEventCase()) {
      case GameEvent.EventCase.BID_DECLARE_CHANGED:
        const bidDeclareChanged = event.getBidDeclareChanged()!;

        this.gameState.changeBidDeclare(
        bidDeclareChanged.getChangedPlayerId(),
        bidDeclareChanged.getChangedBid());

        return Object.create(this.gameState);

      default:
        return this;
    }
  }

  getGameEvents = this.gameState.eventStack.getGameEvents;

  getDeck(): Map<string, Card> {
    return this.gameState.deckMap;
  }
}

export class FinishedPhase implements GameState {

  constructor(
  readonly deck: Map<string, Card>,
  readonly gameRoomId: string,
  readonly myPlayerId: string,
  readonly roomOwnerId: string,
  readonly eventStack: GameEventStack,
  readonly rule: GameRule,
  readonly winnerId: string,
  readonly gameScore: ScoreBoard,
  ) {
  }

  applyEvent(event: GameEvent): GameState {
    this.eventStack.appendGameEvent(event);

    switch (event.getEventCase()) {
      case GameEvent.EventCase.GAME_ENDED:
        return new GameEnded();

      case GameEvent.EventCase.ROUND_STARTED:
        return createBiddingPhase(
        this.deck,
        this.gameRoomId,
        this.myPlayerId, this.eventStack, this.rule,
        this.roomOwnerId, this.winnerId, [], event.getRoundStarted()!
        );

      default:
        return this;
    }
  }

  getGameEvents = this.eventStack.getGameEvents;

  getDeck(): Map<string, Card> {
    return this.deck;
  }

}

export class GameEnded implements GameState {

  applyEvent(event: GameEvent): GameState {
    return this;
  }

  getGameEvents(): string[] {
    return [];
  }


  getDeck(): Map<string, Card> {
    return new Map();
  }

}