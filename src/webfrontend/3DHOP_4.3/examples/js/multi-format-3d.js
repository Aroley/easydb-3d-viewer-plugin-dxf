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
		return s.replace(/^\s+|\s+$/g, '');
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

		while (i < lines.length) {
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
		// Extract 3D entities (3DFACE, LWPOLYLINE, etc.)
		var entities = [];
		var currentEntity = null;
		var i = 0;

		while (i < groups.length) {
			var code = groups[i].code;
			var value = groups[i].value;

			if (code === 0 && (value === "3DFACE" || value === "LWPOLYLINE" || value === "LINE" || value === "POLYLINE")) {
				if (currentEntity) entities.push(currentEntity);
				currentEntity = {
					type: value,
					points: [],
					properties: {}
				};
			}
			else if (currentEntity) {
				// Group codes for coordinates
				if (code === 10 || code === 20 || code === 30) {
					// X, Y, Z coordinates
					if (code === 10) currentEntity.points.push({ x: parseFloat(value), y: 0, z: 0 });
					else if (code === 20 && currentEntity.points.length > 0) currentEntity.points[currentEntity.points.length - 1].y = parseFloat(value);
					else if (code === 30 && currentEntity.points.length > 0) currentEntity.points[currentEntity.points.length - 1].z = parseFloat(value);
				}
			}
			i++;
		}

		if (currentEntity) entities.push(currentEntity);
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
