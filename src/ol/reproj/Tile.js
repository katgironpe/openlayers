/**
 * @module ol/reproj/Tile
 */
import {ERROR_THRESHOLD} from './common.js';
import {inherits} from '../index.js';
import _ol_Tile_ from '../Tile.js';
import TileState from '../TileState.js';
import _ol_events_ from '../events.js';
import EventType from '../events/EventType.js';
import {getArea, getCenter, getIntersection} from '../extent.js';
import {clamp} from '../math.js';
import _ol_reproj_ from '../reproj.js';
import _ol_reproj_Triangulation_ from '../reproj/Triangulation.js';

/**
 * @classdesc
 * Class encapsulating single reprojected tile.
 * See {@link ol.source.TileImage}.
 *
 * @constructor
 * @extends {ol.Tile}
 * @param {ol.proj.Projection} sourceProj Source projection.
 * @param {ol.tilegrid.TileGrid} sourceTileGrid Source tile grid.
 * @param {ol.proj.Projection} targetProj Target projection.
 * @param {ol.tilegrid.TileGrid} targetTileGrid Target tile grid.
 * @param {ol.TileCoord} tileCoord Coordinate of the tile.
 * @param {ol.TileCoord} wrappedTileCoord Coordinate of the tile wrapped in X.
 * @param {number} pixelRatio Pixel ratio.
 * @param {number} gutter Gutter of the source tiles.
 * @param {ol.ReprojTileFunctionType} getTileFunction
 *     Function returning source tiles (z, x, y, pixelRatio).
 * @param {number=} opt_errorThreshold Acceptable reprojection error (in px).
 * @param {boolean=} opt_renderEdges Render reprojection edges.
 */
var _ol_reproj_Tile_ = function(sourceProj, sourceTileGrid,
    targetProj, targetTileGrid, tileCoord, wrappedTileCoord,
    pixelRatio, gutter, getTileFunction,
    opt_errorThreshold, opt_renderEdges) {
  _ol_Tile_.call(this, tileCoord, TileState.IDLE);

  /**
   * @private
   * @type {boolean}
   */
  this.renderEdges_ = opt_renderEdges !== undefined ? opt_renderEdges : false;

  /**
   * @private
   * @type {number}
   */
  this.pixelRatio_ = pixelRatio;

  /**
   * @private
   * @type {number}
   */
  this.gutter_ = gutter;

  /**
   * @private
   * @type {HTMLCanvasElement}
   */
  this.canvas_ = null;

  /**
   * @private
   * @type {ol.tilegrid.TileGrid}
   */
  this.sourceTileGrid_ = sourceTileGrid;

  /**
   * @private
   * @type {ol.tilegrid.TileGrid}
   */
  this.targetTileGrid_ = targetTileGrid;

  /**
   * @private
   * @type {ol.TileCoord}
   */
  this.wrappedTileCoord_ = wrappedTileCoord ? wrappedTileCoord : tileCoord;

  /**
   * @private
   * @type {!Array.<ol.Tile>}
   */
  this.sourceTiles_ = [];

  /**
   * @private
   * @type {Array.<ol.EventsKey>}
   */
  this.sourcesListenerKeys_ = null;

  /**
   * @private
   * @type {number}
   */
  this.sourceZ_ = 0;

  var targetExtent = targetTileGrid.getTileCoordExtent(this.wrappedTileCoord_);
  var maxTargetExtent = this.targetTileGrid_.getExtent();
  var maxSourceExtent = this.sourceTileGrid_.getExtent();

  var limitedTargetExtent = maxTargetExtent ?
    getIntersection(targetExtent, maxTargetExtent) : targetExtent;

  if (getArea(limitedTargetExtent) === 0) {
    // Tile is completely outside range -> EMPTY
    // TODO: is it actually correct that the source even creates the tile ?
    this.state = TileState.EMPTY;
    return;
  }

  var sourceProjExtent = sourceProj.getExtent();
  if (sourceProjExtent) {
    if (!maxSourceExtent) {
      maxSourceExtent = sourceProjExtent;
    } else {
      maxSourceExtent = getIntersection(maxSourceExtent, sourceProjExtent);
    }
  }

  var targetResolution = targetTileGrid.getResolution(
      this.wrappedTileCoord_[0]);

  var targetCenter = getCenter(limitedTargetExtent);
  var sourceResolution = _ol_reproj_.calculateSourceResolution(
      sourceProj, targetProj, targetCenter, targetResolution);

  if (!isFinite(sourceResolution) || sourceResolution <= 0) {
    // invalid sourceResolution -> EMPTY
    // probably edges of the projections when no extent is defined
    this.state = TileState.EMPTY;
    return;
  }

  var errorThresholdInPixels = opt_errorThreshold !== undefined ?
    opt_errorThreshold : ERROR_THRESHOLD;

  /**
   * @private
   * @type {!ol.reproj.Triangulation}
   */
  this.triangulation_ = new _ol_reproj_Triangulation_(
      sourceProj, targetProj, limitedTargetExtent, maxSourceExtent,
      sourceResolution * errorThresholdInPixels);

  if (this.triangulation_.getTriangles().length === 0) {
    // no valid triangles -> EMPTY
    this.state = TileState.EMPTY;
    return;
  }

  this.sourceZ_ = sourceTileGrid.getZForResolution(sourceResolution);
  var sourceExtent = this.triangulation_.calculateSourceExtent();

  if (maxSourceExtent) {
    if (sourceProj.canWrapX()) {
      sourceExtent[1] = clamp(
          sourceExtent[1], maxSourceExtent[1], maxSourceExtent[3]);
      sourceExtent[3] = clamp(
          sourceExtent[3], maxSourceExtent[1], maxSourceExtent[3]);
    } else {
      sourceExtent = getIntersection(sourceExtent, maxSourceExtent);
    }
  }

  if (!getArea(sourceExtent)) {
    this.state = TileState.EMPTY;
  } else {
    var sourceRange = sourceTileGrid.getTileRangeForExtentAndZ(
        sourceExtent, this.sourceZ_);

    for (var srcX = sourceRange.minX; srcX <= sourceRange.maxX; srcX++) {
      for (var srcY = sourceRange.minY; srcY <= sourceRange.maxY; srcY++) {
        var tile = getTileFunction(this.sourceZ_, srcX, srcY, pixelRatio);
        if (tile) {
          this.sourceTiles_.push(tile);
        }
      }
    }

    if (this.sourceTiles_.length === 0) {
      this.state = TileState.EMPTY;
    }
  }
};

inherits(_ol_reproj_Tile_, _ol_Tile_);


/**
 * @inheritDoc
 */
_ol_reproj_Tile_.prototype.disposeInternal = function() {
  if (this.state == TileState.LOADING) {
    this.unlistenSources_();
  }
  _ol_Tile_.prototype.disposeInternal.call(this);
};


/**
 * Get the HTML Canvas element for this tile.
 * @return {HTMLCanvasElement} Canvas.
 */
_ol_reproj_Tile_.prototype.getImage = function() {
  return this.canvas_;
};


/**
 * @private
 */
_ol_reproj_Tile_.prototype.reproject_ = function() {
  var sources = [];
  this.sourceTiles_.forEach(function(tile, i, arr) {
    if (tile && tile.getState() == TileState.LOADED) {
      sources.push({
        extent: this.sourceTileGrid_.getTileCoordExtent(tile.tileCoord),
        image: tile.getImage()
      });
    }
  }.bind(this));
  this.sourceTiles_.length = 0;

  if (sources.length === 0) {
    this.state = TileState.ERROR;
  } else {
    var z = this.wrappedTileCoord_[0];
    var size = this.targetTileGrid_.getTileSize(z);
    var width = typeof size === 'number' ? size : size[0];
    var height = typeof size === 'number' ? size : size[1];
    var targetResolution = this.targetTileGrid_.getResolution(z);
    var sourceResolution = this.sourceTileGrid_.getResolution(this.sourceZ_);

    var targetExtent = this.targetTileGrid_.getTileCoordExtent(
        this.wrappedTileCoord_);
    this.canvas_ = _ol_reproj_.render(width, height, this.pixelRatio_,
        sourceResolution, this.sourceTileGrid_.getExtent(),
        targetResolution, targetExtent, this.triangulation_, sources,
        this.gutter_, this.renderEdges_);

    this.state = TileState.LOADED;
  }
  this.changed();
};


/**
 * @inheritDoc
 */
_ol_reproj_Tile_.prototype.load = function() {
  if (this.state == TileState.IDLE) {
    this.state = TileState.LOADING;
    this.changed();

    var leftToLoad = 0;

    this.sourcesListenerKeys_ = [];
    this.sourceTiles_.forEach(function(tile, i, arr) {
      var state = tile.getState();
      if (state == TileState.IDLE || state == TileState.LOADING) {
        leftToLoad++;

        var sourceListenKey;
        sourceListenKey = _ol_events_.listen(tile, EventType.CHANGE,
            function(e) {
              var state = tile.getState();
              if (state == TileState.LOADED ||
                  state == TileState.ERROR ||
                  state == TileState.EMPTY) {
                _ol_events_.unlistenByKey(sourceListenKey);
                leftToLoad--;
                if (leftToLoad === 0) {
                  this.unlistenSources_();
                  this.reproject_();
                }
              }
            }, this);
        this.sourcesListenerKeys_.push(sourceListenKey);
      }
    }.bind(this));

    this.sourceTiles_.forEach(function(tile, i, arr) {
      var state = tile.getState();
      if (state == TileState.IDLE) {
        tile.load();
      }
    });

    if (leftToLoad === 0) {
      setTimeout(this.reproject_.bind(this), 0);
    }
  }
};


/**
 * @private
 */
_ol_reproj_Tile_.prototype.unlistenSources_ = function() {
  this.sourcesListenerKeys_.forEach(_ol_events_.unlistenByKey);
  this.sourcesListenerKeys_ = null;
};
export default _ol_reproj_Tile_;
