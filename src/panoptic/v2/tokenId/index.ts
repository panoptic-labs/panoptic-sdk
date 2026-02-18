/**
 * TokenId utilities for the Panoptic v2 SDK.
 * @module v2/tokenId
 */

export {
  type LegConfig,
  type LoanCreditConfig,
  type TokenIdBuilder,
  createTokenIdBuilder,
} from './builder'
export {
  type Timescale,
  DEFAULT_VEGOID,
  LEG_BITS,
  LEG_LIMITS,
  LEG_MASKS,
  STANDARD_TICK_WIDTHS,
  TOKEN_ID_BITS,
} from './constants'
export {
  type DecodedTokenId,
  decodeTokenId,
  getAssetIndex,
  hasCreditLeg,
  hasLoanLeg,
  hasLoanOrCredit,
  hasLongLeg,
  isCredit,
  isCreditLeg,
  isLoan,
  isLoanLeg,
  isShortOnly,
  isSpread,
  validatePoolId,
} from './decode'
export {
  type DecodedLeg,
  type EncodeLegParams,
  addLegToTokenId,
  convertStrikeToSigned,
  convertStrikeToUnsigned,
  countLegs,
  decodeAllLegs,
  decodeLeg,
  decodePoolId,
  decodeTickSpacing,
  decodeVegoid,
  encodeLeg,
  encodePoolId,
  encodeV4PoolId,
} from './encoding'
