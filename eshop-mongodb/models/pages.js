// Supported operations:
// "render" renders page
// "render-multiple" renders multiple pages (uses "render")
// "breadcrumb" creates bredcrumb (uses "render")
// "clear" clears database

// Supported workflows
// "create-url"

NEWSCHEMA('Page').make(function(schema) {

	schema.define('id', 'String(10)');
	schema.define('parent', 'String(10)');
	schema.define('template', 'String(30)', true);
	schema.define('language', 'String(3)');
	schema.define('url', 'String(200)');
	schema.define('keywords', 'String(200)');
	schema.define('icon', 'String(20)');
	schema.define('navigations', '[String]');
	schema.define('widgets', '[String]'); // Widgets lists, contains Array of ID widget
	schema.define('settings', '[String]'); // Widget settings (according to widgets array index)
	schema.define('tags', '[String]');
	schema.define('search', 'String(1000)');
	schema.define('pictures', '[String]') // URL addresses for first 5 pictures
	schema.define('name', 'String(50)');
	schema.define('perex', 'String(500)');
	schema.define('title', 'String(100)', true);
	schema.define('priority', Number);
	schema.define('ispartial', Boolean);
	schema.define('body', String);
	schema.define('datecreated', Date);

	// Sets default values
	schema.setDefault(function(name) {
		switch (name) {
			case 'datecreated':
				return new Date();
		}
	});

	// Gets listing
	schema.setQuery(function(error, options, callback) {

		// options.search {String}
		// options.navigation {String}
		// options.language {String}
		// options.ispartial {Boolean}
		// options.page {String or Number}
		// options.max {String or Number}

		options.page = U.parseInt(options.page) - 1;
		options.max = U.parseInt(options.max, 20);

		if (options.page < 0)
			options.page = 0;

		var take = U.parseInt(options.max);
		var skip = U.parseInt(options.page * options.max);
		var builder = new MongoBuilder();

		builder.where('isremoved', false);

		// Checks partial content
		if (options.ispartial)
			builder.where('ispartial', options.ispartial);

		// Checks language
		if (options.language)
			builder.where('language', options.language);

		// Checks navigations
		if (options.navigation)
			builder.in('navigations', options.navigation);

		if (options.search) {
			builder.in('search', options.search.keywords(true, true));
		}

		builder.fields('id', 'name', 'parent', 'url', 'navigations', 'ispartial', 'priority', 'language', 'icon');
		builder.sort('name');
		builder.take(take);
		builder.skip(skip);
		builder.findCount(DB('pages'), function(err, docs, count) {

			var data = {};

			data.count = count;
			data.items = docs;
			data.pages = Math.floor(count / options.max) + (count % options.max ? 1 : 0);

			if (data.pages === 0)
				data.pages = 1;

			data.page = options.page + 1;

			// Returns data
			callback(data);
		});
	});

	// Gets a specific page
	schema.setGet(function(error, model, options, callback) {

		// options.url {String}
		// options.id {String}
		// options.language {String}

		var builder = new MongoBuilder();

		builder.where('isremoved', false);

		if (options.url)
			builder.where('url', options.url);

		if (options.id)
			builder.where('id', options.id);

		if (options.language)
			builder.where('language', options.language);

		// Gets specific document
		builder.findOne(DB('pages'), function(err, doc) {
			if (doc)
				return callback(doc);
			error.push('error-404-page');
			callback();
		});
	});

	// Removes a specific page
	schema.setRemove(function(error, id, callback) {

		var builder = new MongoBuilder();
		builder.where('id', id);
		builder.where('isremoved', false);

		// Updates database file
		builder.updateOne(DB('pages'), callback);

		// Refreshes internal informations e.g. sitemap
		setTimeout(refresh, 1000);
	});

	// Saves the page into the database
	schema.setSave(function(error, model, options, callback) {

		// options.id {String}
		// options.url {String}

		if (!model.name)
			model.name = model.title;

		var count = 0;
		var isnew = false;

		if (!model.id) {
			model.id = U.GUID(10);
			model.datecreated = new Date();
			isnew = true;
		} else
			model.dateupdated = new Date();

		if (model.search)
			model.search = ((model.title || '') + ' ' + (model.keywords || '') + ' ' + model.search).keywords(true, true);

		// Sanitizes URL
		if (model.url[0] !== '#' && !model.url.startsWith('http:') && !model.url.startsWith('https:')) {
			model.url = U.path(model.url);
			if (model.url[0] !== '/')
				model.url = '/' + model.url;
		}

		model.isremoved = false;

		// Removes unnecessary properties (e.g. SchemaBuilder internal properties and methods)
		var builder = new MongoBuilder();

		// Callback
		var cb = function() {
			// Returns response
			callback(SUCCESS(true));
			// Refreshes internal informations e.g. sitemap
			setTimeout(refresh, 1000);
		};

		builder.set(model);

		if (isnew)
			builder.insert(DB('pages'), cb);
		else
			builder.updateOne(DB('pages'), cb);

	});

	schema.addWorkflow('create-url', function(error, model, options, callback) {

		if (!model.parent) {
			model.url = model.title.slug();
			return callback();
		}

		var options = {};
		options.id = model.parent;

		// Gets Parent
		schema.get(options, function(err, response) {

			if (err) {
				model.url = model.title.slug();
				return callback();
			}

			// Gets parent URL and adds current page title
			model.url = response.url + model.title.slug() + '/';
			callback();
		});
	});

	// Renders page
	schema.addOperation('render', function(error, model, options, callback) {

		// options.id {String}
		// options.url {String}

		if (typeof(options) === 'string') {
			var tmp = options;
			options = {};
			options.id = options.url = tmp;
		}

		// Gets the page
		schema.get(options, function(err, response) {

			if (err) {
				error.push(err);
				return callback();
			}

			if (!response) {
				error.push('error-404-page');
				return callback();
			}

			// Loads breadcrumb
			var key = (response.language ? response.language + ':' : '') + response.url;
			schema.operation('breadcrumb', key, function(err, breadcrumb) {

				if (breadcrumb && breadcrumb.length > 0)
					breadcrumb[0].first = true;

				response.breadcrumb = breadcrumb;

				if (response.body)
					response.body = response.body.replace(' id="CMS"', '');

				if (!response.widgets)
					return callback(response);

				var Widget = GETSCHEMA('Widget');

				// Loads widgets
				Widget.workflow('load', null, response.widgets, function(err, widgets) {
					var index = 0;
					response.widgets.wait(function(key, next) {
						// INIT WIDGET
						var custom = {};
						custom.settings = response.settings[index++];
						custom.page = response;
						custom.controller = options.controller;

						if (!widgets[key]) {
							F.error(new Error('Widget # ' + key + ' not found'), 'Page: ' + response.name, response.url);
							return next();
						}

						// Executes transform
						Widget.transform(key, widgets[key], custom, function(err, content) {

							if (err) {
								F.error(err, 'Widget: ' + widgets[key].name + ' - ' + key + ' (page: ' + response.name + ')', response.url);
								return next();
							}

							response.body = response.body.replace('data-id="' + key + '">', '>' + content);
							next();
						}, true);

					}, function() {
						// DONE
						if (response.language)
							response.body = F.translator(response.language, response.body);

						response.body = U.minifyHTML(response.body.replace(/<br>/g, '<br />'));

						// cleaner
						response.body = response.body.replace(/(\s)class\=\".*?\"/g, function(text) {

							var is = text[0] === ' ';
							var arr = text.substring(is ? 8 : 7, text.length - 1).split(' ');
							var builder = '';

							for (var i = 0, length = arr.length; i < length; i++) {
								var cls = arr[i];
								if (cls[0] === 'C' && cls[3] === '_' && cls !== 'CMS_hidden')
									continue;
								builder += (builder ? ' ' : '') + cls;
							}

							return builder ? (is ? ' ' : '') + 'class="' + builder + '"' : '';
						});

						callback(response);
					});
				}, true);
			});
		});
	});

	// Renders multiple page
	schema.addOperation('render-multiple', function(error, model, options, callback) {

		// options.id {String Array}
		// options.url {String Array}
		// options.language {String}

		var output = {};
		var pending = [];

		if (options.url instanceof Array) {
			for (var i = 0, length = options.url.length; i < length; i++) {
				(function(id) {
					pending.push(function(next) {
						var custom = {};
						custom.url = id;
						custom.language = options.language;
						schema.operation('render', custom, function(err, response) {
							output[id] = response;
							next();
						});
					});
				})(options.url[i]);
			}
		}

		if (options.id instanceof Array) {
			for (var i = 0, length = options.id.length; i < length; i++) {
				(function(id) {
					pending.push(function(next) {
						var custom = {};
						custom.id = id;
						custom.language = options.language;
						schema.operation('render', custom, function(err, response) {
							output[id] = response;
							next();
						});
					});
				})(options.id[i]);
			}
		}

		pending.async(function() {
			callback(output);
		});
	});

	// Loads breadcrumb according to URL
	schema.addOperation('breadcrumb', function(error, model, url, callback) {

		var arr = [];

		while (true) {
			var item = F.global.sitemap[url];
			if (!item)
				break;
			arr.push(item);
			url = item.parent;
		};

		arr.reverse();
		callback(arr);
	});

	// Clears database
	schema.addWorkflow('clear', function(error, model, options, callback) {
		var builder = new MongoBuilder();

		builder.remove(DB('pages'), function() {
			setTimeout(refresh, 1000);
		});

		callback(SUCCESS(true));
	});

});

// Refreshes internal informations (sitemap and navigations)
function refresh() {

	var sitemap = {};
	var helper = {};
	var navigation = {};

	var builder = new MongoBuilder();
	builder.where('isremoved', false);
	builder.where('ispartial', false);
	builder.fields('id', 'language', 'url', 'name', 'title', 'parent', 'language', 'icon', 'tags', 'navigations');

	var prepare = function(doc) {

		var key = (doc.language ? doc.language + ':' : '') + doc.url;

		helper[doc.id] = key;
		sitemap[key] = { id: doc.id, url: doc.url, name: doc.name, title: doc.title, parent: doc.parent, language: doc.language, icon: doc.icon, tags: doc.tags };

		if (!doc.navigations)
			return;

		// Loads navigation by menu id
		for (var i = 0, length = doc.navigations.length; i < length; i++) {
			var name = doc.navigations[i];
			if (!navigation[name])
				navigation[name] = [];
			navigation[name].push({ url: doc.url, name: doc.name, title: doc.title, priority: doc.priority, language: doc.language, icon: doc.icon, tags: doc.tags });
		}
	};

	builder.find(DB('pages'), function(err, docs) {

		for (var i = 0, length = docs.length; i < length; i++)
			prepare(docs[i]);

		// Pairs parents by URL
		Object.keys(sitemap).forEach(function(key) {
			var parent = sitemap[key].parent;
			if (parent)
				sitemap[key].parent = helper[parent];
		});

		// Sorts navigation according to priority
		Object.keys(navigation).forEach(function(name) {
			navigation[name].sort(function(a, b) {
				if (a.priority > b.priority)
					return -1;
				return a.priority < b.priority ? 1 : 0;
			});
		});

		F.global.navigations = navigation;
		F.global.sitemap = sitemap;
	});
}

// Creates Controller.prototype.page()
F.eval(function() {
	Controller.prototype.page = function(url, view, model, cache, partial) {

		var self = this;
		var tv = typeof(view);

		if (tv === 'object') {
			model = view;
			view = undefined;
		} else if (tv === 'boolean') {
			cache = view;
			view = undefined;
			model = null;
		}

		if (typeof(model) === 'boolean') {
			cache = model;
			model = null;
		}

		if (cache === undefined)
			cache = true;

		if (!partial) {
			if (self.language)
				url = self.language + ':' + url;

			if (!F.global.sitemap[url]) {
				self.status = 404;
				self.plain(U.httpStatus(404, true));
				return self;
			}
		}

		self.memorize('cache.' + url, '1 minute', DEBUG || cache !== true, function() {

			var options = {};

			options.language = self.language;
			options.url = self.url;
			options.controller = self;

			GETSCHEMA('Page').operation('render', options, function(err, response) {

				if (err) {
					self.status = 404;
					self.plain(U.httpStatus(404, true));
					return;
				}

				self.repository.cms = true;
				self.repository.render = true;
				self.repository.page = response;

				self.sitemap(response.breadcrumb);
				self.title(response.title);

				if (!view)
					view = '~/cms/' + response.template;

				self.view(view, model);
			});
		});

		return self;
	};
});

// Renders page and stores into the repository
F.middleware('page', function(req, res, next, options, controller) {

	if (!controller) {
		res.throw404();
		return;
	}

	controller.memorize('cache.' + controller.url, '1 minute', DEBUG, function() {
		controller.page(controller.url);
	});
});

F.on('database', refresh);