/*
Multi-Format 3D Model Parser
Handles: DXF, PLN, DWG file formats
Similar structure to ply.js but adapted for different 3D file formats
Compatible with SpiderGL rendering engine
*/

// ============================================================================
// DXF Parser - Autodesk Drawing Exchange Format (ASCII text-based)
// ============================================================================
var parseDxf = (function(){
	function trim(s) {
		if (s === null || typeof s === "undefined") return "";
		return String(s).replace(/^\s+|\s+$/g, '');
	}

	function extractGroups(data) {
		// DXF files are organized in group code pairs (code, value)
		if (!data || !data.view || !data.view.buffer) return null;

		var u8 = new Uint8Array(data.view.buffer);
		var text = Array.prototype.map.call(u8, function(x) {
			return String.fromCharCode(x);
		}).join("");

		var lines = text.split("\n");
		var groups = [];
		var i = 0;

		while (i + 1 < lines.length) {
			var code = parseInt(trim(lines[i]));
			var value = trim(lines[i + 1]);
			groups.push({ code: code, value: value });
			i += 2;
		}

		return groups;
	}

	function parseHeader(groups) {
		var header = {
			version: "DXF",
			sections: {},
			properties: {}
		};

		var currentSection = null;
		var i = 0;

		while (i < groups.length) {
			var code = groups[i].code;
			var value = groups[i].value;

			// Section markers (0 = entity type, "SECTION" = section start)
			if (code === 0 && value === "SECTION") {
				i++;
				if (i < groups.length && groups[i].code === 2) {
					currentSection = groups[i].value;
					header.sections[currentSection] = [];
				}
			}
			i++;
		}

		return header;
	}

	function extractEntities(groups) {
		// Extract DXF entities from the ENTITIES section, preserving properties
		// and nesting VERTEX records inside POLYLINE records.
		var entities = [];
		var section = null;
		var currentEntity = null;
		var currentVertex = null;

		function createEntity(type) {
			return {
				type: type,
				props: {},
				vertices: []
			};
		}

		function addProp(target, code, value) {
			if (!target.props[code]) target.props[code] = [];
			target.props[code].push(value);
		}

		function flushVertex() {
			if (currentVertex && currentEntity && currentEntity.type === "POLYLINE") {
				currentEntity.vertices.push(currentVertex);
			}
			currentVertex = null;
		}

		function flushEntity() {
			flushVertex();
			if (currentEntity) entities.push(currentEntity);
			currentEntity = null;
		}

		for (var i = 0; i < groups.length; i++) {
			var code = groups[i].code;
			var value = groups[i].value;

			if (code === 0) {
				if (value === "SECTION") {
					flushEntity();
					if ((i + 1) < groups.length && groups[i + 1].code === 2) {
						section = groups[i + 1].value;
						i++;
					}
					continue;
				}

				if (value === "ENDSEC") {
					flushEntity();
					section = null;
					continue;
				}

				if (section !== "ENTITIES") {
					continue;
				}

				if (value === "VERTEX" && currentEntity && currentEntity.type === "POLYLINE") {
					flushVertex();
					currentVertex = createEntity("VERTEX");
					continue;
				}

				if (value === "SEQEND") {
					flushEntity();
					continue;
				}

				if (currentVertex) flushVertex();
				if (currentEntity) flushEntity();

				currentEntity = createEntity(value);
				continue;
			}

			if (section !== "ENTITIES") continue;

			if (currentVertex) addProp(currentVertex, code, value);
			else if (currentEntity) addProp(currentEntity, code, value);
		}

		flushEntity();
		return entities;
	}

	function mainParseDxf(buffer, handler) {
		if (!buffer) return null;

		handler = handler || {};
		var callbacks = {
			onBegin: (handler.onBegin || function() {}),
			onHeader: (handler.onHeader || function() {}),
			onEntity: (handler.onEntity || function() {}),
			onEnd: (handler.onEnd || function() {})
		};

		var dataView = new DataView(buffer);
		var data = { view: dataView, pos: 0 };

		var groups = extractGroups(data);
		if (!groups) return false;

		var header = parseHeader(groups);
		var entities = extractEntities(groups);

		callbacks.onBegin.call(handler);
		callbacks.onHeader.call(handler, header);

		for (var e = 0; e < entities.length; e++) {
			callbacks.onEntity.call(handler, header, entities[e], e);
		}

		callbacks.onEnd.call(handler);
		return true;
	}

	return mainParseDxf;
})();

// ============================================================================
// PLN Parser - Custom Plan/Floor Plan Format
// ============================================================================
var parsePln = (function(){
	function extractHeader(data) {
		// PLN files typically have a simple header with model dimensions and metadata
		if (!data || !data.view || !data.view.buffer) return null;

		var u8 = new Uint8Array(data.view.buffer);
		var text = Array.prototype.map.call(u8, function(x) {
			return String.fromCharCode(x);
		}).join("");

		var lines = text.split("\n");
		var header = {
			format: "PLN",
			width: 0,
			height: 0,
			depth: 0,
			elements: []
		};

		for (var i = 0; i < Math.min(lines.length, 20); i++) {
			var line = lines[i].trim();
			if (line.indexOf("WIDTH:") === 0) header.width = parseFloat(line.split(":")[1]);
			if (line.indexOf("HEIGHT:") === 0) header.height = parseFloat(line.split(":")[1]);
			if (line.indexOf("DEPTH:") === 0) header.depth = parseFloat(line.split(":")[1]);
		}

		return { header: header, startLine: 20 };
	}

	function extractGeometry(data, startLine) {
		// Parse geometric elements from the file
		if (!data || !data.view || !data.view.buffer) return [];

		var u8 = new Uint8Array(data.view.buffer);
		var text = Array.prototype.map.call(u8, function(x) {
			return String.fromCharCode(x);
		}).join("");

		var lines = text.split("\n");
		var elements = [];
		var currentElement = null;

		for (var i = startLine; i < lines.length; i++) {
			var line = lines[i].trim();
			if (!line) continue;

			if (line.indexOf("ELEMENT:") === 0) {
				if (currentElement) elements.push(currentElement);
				currentElement = {
					type: line.split(":")[1].trim(),
					vertices: [],
					properties: {}
				};
			}
			else if (currentElement && line.indexOf("V:") === 0) {
				// Vertex: V: x y z
				var parts = line.substring(2).split(" ");
				currentElement.vertices.push({
					x: parseFloat(parts[0]),
					y: parseFloat(parts[1]),
					z: parseFloat(parts[2])
				});
			}
			else if (currentElement && line.indexOf("PROP:") === 0) {
				// Property
				var propParts = line.substring(5).split("=");
				if (propParts.length === 2) {
					currentElement.properties[propParts[0].trim()] = propParts[1].trim();
				}
			}
		}

		if (currentElement) elements.push(currentElement);
		return elements;
	}

	function mainParsePln(buffer, handler) {
		if (!buffer) return null;

		handler = handler || {};
		var callbacks = {
			onBegin: (handler.onBegin || function() {}),
			onHeader: (handler.onHeader || function() {}),
			onElement: (handler.onElement || function() {}),
			onEnd: (handler.onEnd || function() {})
		};

		var dataView = new DataView(buffer);
		var data = { view: dataView, pos: 0 };

		var headerInfo = extractHeader(data);
		if (!headerInfo) return false;

		var elements = extractGeometry(data, headerInfo.startLine);

		callbacks.onBegin.call(handler);
		callbacks.onHeader.call(handler, headerInfo.header);

		for (var e = 0; e < elements.length; e++) {
			callbacks.onElement.call(handler, headerInfo.header, elements[e], e);
		}

		callbacks.onEnd.call(handler);
		return true;
	}

	return mainParsePln;
})();

// ============================================================================
// DWG Parser - Autodesk DWG Format (Binary - Simplified)
// ============================================================================
var parseDwg = (function(){
	function extractDwgHeader(data) {
		// DWG files start with a fixed header
		if (!data || !data.view || !data.view.buffer) return null;

		var u8 = new Uint8Array(data.view.buffer);
		var headerStr = "";

		// First 6 bytes identify DWG version
		for (var i = 0; i < 6; i++) {
			headerStr += String.fromCharCode(u8[i]);
		}

		if (headerStr.indexOf("AC") !== 0) return null; // Not a valid DWG file

		var version = headerStr.substring(2); // e.g., "1024" for AC1024

		return {
			version: version,
			isValid: true,
			startPos: 6
		};
	}

	function extractObjects(data, startPos) {
		// Simplified extraction - DWG format is complex and proprietary
		// This is a placeholder for full DWG parsing
		var objects = [];
		var u8 = new Uint8Array(data.view.buffer);

		// In a full implementation, you would:
		// 1. Parse the header
		// 2. Read object map
		// 3. Decompress sections (if compressed)
		// 4. Extract entities with their properties

		// For now, we'll mark it as requiring specialized library
		objects.push({
			type: "DWG_ENTITY",
			note: "Full DWG parsing requires specialized decoder library",
			position: { x: 0, y: 0, z: 0 }
		});

		return objects;
	}

	function mainParseDwg(buffer, handler) {
		if (!buffer) return null;

		handler = handler || {};
		var callbacks = {
			onBegin: (handler.onBegin || function() {}),
			onHeader: (handler.onHeader || function() {}),
			onObject: (handler.onObject || function() {}),
			onEnd: (handler.onEnd || function() {})
		};

		var dataView = new DataView(buffer);
		var data = { view: dataView, pos: 0 };

		var header = extractDwgHeader(data);
		if (!header || !header.isValid) return false;

		var objects = extractObjects(data, header.startPos);

		callbacks.onBegin.call(handler);
		callbacks.onHeader.call(handler, header);

		for (var o = 0; o < objects.length; o++) {
			callbacks.onObject.call(handler, header, objects[o], o);
		}

		callbacks.onEnd.call(handler);
		return true;
	}

	return mainParseDwg;
})();

// ============================================================================
// Universal Importer - Converts any format to SpiderGL model descriptor
// ============================================================================
var importMultiFormat = (function(){
	function emptyFunction() {}

	function ModelHandler(buffer, format) {
		this._buffer = buffer;
		this._format = format.toUpperCase();
		this._modelDescriptor = null;
		this._verticesCount = 0;
		this._facesCount = 0;
		this._boundingBox = {
			min: [1000000.0, 1000000.0, 1000000.0],
			max: [-1000000.0, -1000000.0, -1000000.0]
		};
		this._vertices = [];
		this._indices = [];
	}

	ModelHandler.prototype = {
		get modelDescriptor() {
			return this._modelDescriptor;
		},

		onBegin: function() {},

		onHeader: function(header) {
			this._header = header;
		},

		onEntity: function(header, entity, index) {
			// Process entity from DXF
			if (entity.points && entity.points.length > 0) {
				for (var i = 0; i < entity.points.length; i++) {
					this._addVertex(entity.points[i]);
				}
			}
		},

		onElement: function(header, element, index) {
			// Process element from PLN
			if (element.vertices && element.vertices.length > 0) {
				for (var i = 0; i < element.vertices.length; i++) {
					this._addVertex(element.vertices[i]);
				}
			}
		},

		onObject: function(header, object, index) {
			// Process object from DWG
			if (object.position) {
				this._addVertex(object.position);
			}
		},

		onEnd: function() {
			this._buildModelDescriptor();
		},

		_addVertex: function(point) {
			if (!point || typeof point.x === 'undefined') return;

			var x = point.x || 0;
			var y = point.y || 0;
			var z = point.z || 0;

			// Update bounding box
			if (x < this._boundingBox.min[0]) this._boundingBox.min[0] = x;
			if (y < this._boundingBox.min[1]) this._boundingBox.min[1] = y;
			if (z < this._boundingBox.min[2]) this._boundingBox.min[2] = z;

			if (x > this._boundingBox.max[0]) this._boundingBox.max[0] = x;
			if (y > this._boundingBox.max[1]) this._boundingBox.max[1] = y;
			if (z > this._boundingBox.max[2]) this._boundingBox.max[2] = z;

			this._vertices.push({ x: x, y: y, z: z });
			this._verticesCount++;
		},

		_buildModelDescriptor: function() {
			if (this._verticesCount === 0) return;

			var modelDescriptor = {
				version: "0.0.1.0 MULTI-FORMAT",
				format: this._format,
				meta: { source: this._format + " file" },
				data: {
					vertexBuffers: {},
					indexBuffers: {}
				},
				access: {
					vertexStreams: {},
					primitiveStreams: {}
				},
				semantic: {
					bindings: {},
					chunks: {}
				},
				logic: {
					parts: {}
				},
				control: {},
				extra: {
					boundingBox: this._boundingBox,
					vertexCount: this._verticesCount,
					renderMode: ["POINT"]
				}
			};

			// Create simple point cloud representation
			var vertexBuffer = new Float32Array(this._verticesCount * 3);
			var vertexIdx = 0;

			for (var i = 0; i < this._vertices.length; i++) {
				vertexBuffer[vertexIdx++] = this._vertices[i].x;
				vertexBuffer[vertexIdx++] = this._vertices[i].y;
				vertexBuffer[vertexIdx++] = this._vertices[i].z;
			}

			modelDescriptor.data.vertexBuffers["mainVertexBuffer"] = {
				typedArray: vertexBuffer.buffer
			};

			modelDescriptor.access.vertexStreams["position"] = {
				buffer: "mainVertexBuffer",
				size: 3,
				type: SpiderGL ? SpiderGL.Type.FLOAT32 : 5126, // WebGL FLOAT type
				stride: 12,
				offset: 0
			};

			var binding = {
				vertexStreams: { POSITION: ["position"] },
				primitiveStreams: {}
			};

			modelDescriptor.semantic.bindings["mainBinding"] = binding;

			modelDescriptor.access.primitiveStreams["vertices"] = {
				mode: SpiderGL ? SpiderGL.Type.POINTS : 0, // POINTS mode
				count: this._verticesCount
			};

			binding.primitiveStreams["POINT"] = ["vertices"];

			modelDescriptor.semantic.chunks["mainChunk"] = {
				techniques: { common: { binding: "mainBinding" } }
			};

			modelDescriptor.logic.parts["mainPart"] = {
				chunks: ["mainChunk"]
			};

			this._modelDescriptor = modelDescriptor;
		}
	};

	function mainImportMultiFormat(buffer, format) {
		var handler = new ModelHandler(buffer, format);
		var parser;

		// Select appropriate parser
		switch (format.toUpperCase()) {
			case "DXF":
				parser = parseDxf;
				handler.onEntity = handler.onEntity;
				break;
			case "PLN":
				parser = parsePln;
				handler.onElement = handler.onElement;
				break;
			case "DWG":
				parser = parseDwg;
				handler.onObject = handler.onObject;
				break;
			default:
				return null;
		}

		parser(buffer, handler);
		return handler.modelDescriptor;
	}

	return mainImportMultiFormat;
})();

function _dxfPointToArray(point) {
	return [point.x || 0, point.y || 0, point.z || 0];
}

function _dxfUpdateBounds(bounds, point) {
	var x = point.x || 0;
	var y = point.y || 0;
	var z = point.z || 0;

	if (x < bounds.min[0]) bounds.min[0] = x;
	if (y < bounds.min[1]) bounds.min[1] = y;
	if (z < bounds.min[2]) bounds.min[2] = z;

	if (x > bounds.max[0]) bounds.max[0] = x;
	if (y > bounds.max[1]) bounds.max[1] = y;
	if (z > bounds.max[2]) bounds.max[2] = z;
}

function _dxfCollectGeometry(entities) {
	var points = [];
	var lines = [];
	var triangles = [];
	var bounds = {
		min: [1000000.0, 1000000.0, 1000000.0],
		max: [-1000000.0, -1000000.0, -1000000.0]
	};

	function num(entity, code, fallback, index) {
		var values = (entity && entity.props && entity.props[code]) ? entity.props[code] : null;
		if (!values || values.length <= 0) return fallback;
		if ((typeof index === "number") && index >= 0 && index < values.length) return parseFloat(values[index]);
		return parseFloat(values[0]);
	}

	function point(x, y, z) {
		return { x: parseFloat(x || 0), y: parseFloat(y || 0), z: parseFloat(z || 0) };
	}

	function addPoint(p) {
		if (!p) return;
		_dxfUpdateBounds(bounds, p);
		points.push([p.x || 0, p.y || 0, p.z || 0]);
	}

	function addLine(a, b) {
		if (!a || !b) return;
		_dxfUpdateBounds(bounds, a);
		_dxfUpdateBounds(bounds, b);
		lines.push([a.x || 0, a.y || 0, a.z || 0]);
		lines.push([b.x || 0, b.y || 0, b.z || 0]);
	}

	function addTriangle(a, b, c) {
		if (!a || !b || !c) return;
		_dxfUpdateBounds(bounds, a);
		_dxfUpdateBounds(bounds, b);
		_dxfUpdateBounds(bounds, c);
		triangles.push([a.x || 0, a.y || 0, a.z || 0]);
		triangles.push([b.x || 0, b.y || 0, b.z || 0]);
		triangles.push([c.x || 0, c.y || 0, c.z || 0]);
	}

	function pointsFromCodes(entity, codeX, codeY, codeZ) {
		var xs = (entity.props[codeX] || []).map(function(v) { return parseFloat(v); });
		var ys = (entity.props[codeY] || []).map(function(v) { return parseFloat(v); });
		var zs = codeZ ? (entity.props[codeZ] || []).map(function(v) { return parseFloat(v); }) : [];
		var count = Math.max(xs.length, ys.length, zs.length, 0);
		var r = [];
		for (var i = 0; i < count; i++) {
			r.push(point(xs[i] || 0, ys[i] || 0, (zs.length > 0 ? (zs[i] || 0) : 0)));
		}
		return r;
	}

	function pointsFromPolylineVertices(entity) {
		var r = [];
		if (!entity.vertices) return r;
		for (var i = 0; i < entity.vertices.length; i++) {
			r = r.concat(pointsFromCodes(entity.vertices[i], 10, 20, 30));
		}
		return r;
	}

	function sampleArc(center, radius, startAngle, endAngle, segments) {
		var r = [];
		var from = startAngle;
		var to = endAngle;
		if (to < from) to += 360.0;
		var step = (to - from) / segments;
		for (var i = 0; i <= segments; i++) {
			var angle = (from + step * i) * Math.PI / 180.0;
			r.push(point(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius, center.z));
		}
		return r;
	}

	function sampleEllipse(entity, segments) {
		var center = point(num(entity, 10, 0), num(entity, 20, 0), num(entity, 30, 0));
		var major = point(num(entity, 11, 1), num(entity, 21, 0), num(entity, 31, 0));
		var ratio = num(entity, 40, 1.0);
		var startAngle = num(entity, 41, 0.0);
		var endAngle = num(entity, 42, Math.PI * 2.0);
		var majorLen = Math.sqrt(major.x * major.x + major.y * major.y + major.z * major.z);
		if (majorLen <= 0) majorLen = 1.0;
		var ux = major.x / majorLen;
		var uy = major.y / majorLen;
		var vx = -uy;
		var vy = ux;
		var minorLen = majorLen * ratio;
		var r = [];
		var from = startAngle;
		var to = endAngle;
		if (to < from) to += Math.PI * 2.0;
		for (var i = 0; i <= segments; i++) {
			var t = from + (to - from) * (i / segments);
			var cx = Math.cos(t);
			var sx = Math.sin(t);
			r.push(point(
				center.x + ux * majorLen * cx + vx * minorLen * sx,
				center.y + uy * majorLen * cx + vy * minorLen * sx,
				center.z
			));
		}
		return r;
	}

	function collectFallbackPoint(entity) {
		var p = pointsFromCodes(entity, 10, 20, 30)[0];
		if (!p) p = pointsFromCodes(entity, 11, 21, 31)[0];
		return p;
	}

	function addPoint(point) {
		if (!point) return;
		_dxfUpdateBounds(bounds, point);
		points.push([point.x || 0, point.y || 0, point.z || 0]);
	}

	for (var e = 0; e < entities.length; e++) {
		var entity = entities[e];
		var directPoints = entity.points || [];
		var polyPoints = entity.vertices ? pointsFromPolylineVertices(entity) : [];

		switch (entity.type) {
			case "LINE":
				addLine(point(num(entity, 10, 0), num(entity, 20, 0), num(entity, 30, 0)), point(num(entity, 11, 0), num(entity, 21, 0), num(entity, 31, 0)));
			break;

			case "LWPOLYLINE":
			case "POLYLINE":
				if (polyPoints.length < 2) polyPoints = directPoints;
			for (var p = 0; p < polyPoints.length - 1; p++) addLine(polyPoints[p], polyPoints[p + 1]);
			if ((num(entity, 70, 0) & 1) && polyPoints.length > 1) addLine(polyPoints[polyPoints.length - 1], polyPoints[0]);
			break;

			case "VERTEX":
				if (directPoints.length > 0) addPoint(directPoints[0]);
			break;

			case "POINT":
				addPoint(point(num(entity, 10, 0), num(entity, 20, 0), num(entity, 30, 0)));
			break;

			case "3DFACE":
			case "SOLID":
			case "TRACE":
				var a = point(num(entity, 10, 0), num(entity, 20, 0), num(entity, 30, 0));
				var b = point(num(entity, 11, 0), num(entity, 21, 0), num(entity, 31, 0));
				var c = point(num(entity, 12, 0), num(entity, 22, 0), num(entity, 32, 0));
				var d = point(num(entity, 13, 0), num(entity, 23, 0), num(entity, 33, 0));
				addTriangle(a, b, c);
				if (entity.type !== "TRACE" && (num(entity, 13, NaN) === num(entity, 12, NaN)) && (num(entity, 23, NaN) === num(entity, 22, NaN)) && (num(entity, 33, NaN) === num(entity, 32, NaN))) {
					break;
				}
				addTriangle(a, c, d);
			break;

			case "CIRCLE":
				var circleCenter = point(num(entity, 10, 0), num(entity, 20, 0), num(entity, 30, 0));
				var circleRadius = num(entity, 40, 0);
				var circlePoints = sampleArc(circleCenter, circleRadius, 0.0, 360.0, 48);
				for (var cp = 0; cp < circlePoints.length - 1; cp++) addLine(circlePoints[cp], circlePoints[cp + 1]);
			break;

			case "ARC":
				var arcCenter = point(num(entity, 10, 0), num(entity, 20, 0), num(entity, 30, 0));
				var arcRadius = num(entity, 40, 0);
				var startAngle = num(entity, 50, 0);
				var endAngle = num(entity, 51, 0);
				var arcPoints = sampleArc(arcCenter, arcRadius, startAngle, endAngle, 32);
				for (var ap = 0; ap < arcPoints.length - 1; ap++) addLine(arcPoints[ap], arcPoints[ap + 1]);
			break;

			case "ELLIPSE":
				var ellipsePoints = sampleEllipse(entity, 48);
				for (var ep = 0; ep < ellipsePoints.length - 1; ep++) addLine(ellipsePoints[ep], ellipsePoints[ep + 1]);
			break;

			case "SPLINE":
				var splinePoints = pointsFromCodes(entity, 10, 20, 30);
				if (splinePoints.length < 2) splinePoints = directPoints;
				for (var sp = 0; sp < splinePoints.length - 1; sp++) addLine(splinePoints[sp], splinePoints[sp + 1]);
			break;

			case "TEXT":
			case "MTEXT":
			case "ATTRIB":
			case "ATTDEF":
			case "INSERT":
			case "DIMENSION":
			case "LEADER":
			case "MLEADER":
			case "IMAGE":
			case "UNDERLAY":
			case "WIPEOUT":
			case "HATCH":
				var fallbackPoint = collectFallbackPoint(entity);
				if (fallbackPoint) addPoint(fallbackPoint);
			break;

			default:
				if (directPoints.length > 0) {
					for (var dp = 0; dp < directPoints.length; dp++) addPoint(directPoints[dp]);
				}
				else {
					var genericPoint = collectFallbackPoint(entity);
					if (genericPoint) addPoint(genericPoint);
				}
			break;
		}
	}

	return {
		points: points,
		lines: lines,
		triangles: triangles,
		bounds: bounds,
		hasPoints: points.length > 0,
		hasLines: lines.length > 0,
		hasTriangles: triangles.length > 0
	};
}

function loadDxfIntoPresenter(url, presenter, entityName, options) {
	options = options || {};
	entityName = entityName || "DXFModel";

	var xhr = new XMLHttpRequest();
	xhr.open("GET", url, true);
	xhr.responseType = "arraybuffer";
	xhr.onload = function () {
		if ((xhr.status !== 0) && (xhr.status !== 200) && (xhr.status !== 206)) {
			if (options.onError) options.onError(new Error("DXF load failed: HTTP " + xhr.status));
			return;
		}

		var entities = [];
		parseDxf(xhr.response, {
			onEntity: function (header, entity) {
				entities.push(entity);
			}
		});

		if (!entities.length) {
			if (options.onError) options.onError(new Error("DXF file did not contain supported geometry."));
			return;
		}

		var geometry = _dxfCollectGeometry(entities);
		var bounds = geometry.bounds;
		var center = [
			(bounds.min[0] + bounds.max[0]) / 2.0,
			(bounds.min[1] + bounds.max[1]) / 2.0,
			(bounds.min[2] + bounds.max[2]) / 2.0
		];
		var radius = Math.sqrt(
			Math.pow(bounds.max[0] - bounds.min[0], 2) +
			Math.pow(bounds.max[1] - bounds.min[1], 2) +
			Math.pow(bounds.max[2] - bounds.min[2], 2)
		) / 2.0;

		presenter.setScene({
			space: {
				centerMode: "explicit",
				explicitCenter: center,
				radiusMode: "explicit",
				explicitRadius: (radius > 0.0 ? radius : 1.0)
			}
		});

		var createdEntities = [];
		var suffix = 0;

		function createDxfEntity(geometryType, vertices) {
			if (!vertices || vertices.length <= 0) return null;
			var created = presenter.createEntity(entityName + "_" + geometryType + "_" + suffix, geometryType, vertices);
			suffix++;
			if (created && created.renderable) {
				created.renderable.boundingBox = bounds;
				created.renderable.datasetCenter = center;
				created.renderable.datasetRadius = (radius > 0.0 ? radius : 1.0);
				created.renderable.renderMode = [geometryType === "triangles" ? "FILL" : (geometryType === "lines" ? "LINE" : "POINT")];
			}
			createdEntities.push(created);
			return created;
		}

		createDxfEntity("triangles", geometry.triangles);
		createDxfEntity("lines", geometry.lines);
		createDxfEntity("points", geometry.points);

		if (presenter.setCenterModeExplicit) presenter.setCenterModeExplicit(center);
		if (presenter.setRadiusModeExplicit) presenter.setRadiusModeExplicit(radius > 0.0 ? radius : 1.0);

			presenter.repaint();

		if (options.onLoaded) options.onLoaded(createdEntities);
	};
	xhr.onerror = function () {
		if (options.onError) options.onError(new Error("DXF load failed."));
	};
	xhr.send();
}
