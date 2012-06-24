/*jshint multistr:true */

// Standard JS module setup
this.recline = this.recline || {};
this.recline.View = this.recline.View || {};

(function($, my) {
// ## MultiView
//
// Manage multiple views together along with query editor etc. Usage:
// 
// <pre>
// var myExplorer = new model.recline.MultiView({
//   model: {{recline.Model.Dataset instance}}
//   el: {{an existing dom element}}
//   views: {{dataset views}}
//   state: {{state configuration -- see below}}
// });
// </pre> 
//
// ### Parameters
// 
// **model**: (required) recline.model.Dataset instance.
//
// **el**: (required) DOM element to bind to. NB: the element already
// being in the DOM is important for rendering of some subviews (e.g.
// Graph).
//
// **views**: (optional) the dataset views (Grid, Graph etc) for
// MultiView to show. This is an array of view hashes. If not provided
// initialize with (recline.View.)Grid, Graph, and Map views (with obvious id
// and labels!).
//
// <pre>
// var views = [
//   {
//     id: 'grid', // used for routing
//     label: 'Grid', // used for view switcher
//     view: new recline.View.Grid({
//       model: dataset
//     })
//   },
//   {
//     id: 'graph',
//     label: 'Graph',
//     view: new recline.View.Graph({
//       model: dataset
//     })
//   }
// ];
// </pre>
//
// **state**: standard state config for this view. This state is slightly
//  special as it includes config of many of the subviews.
//
// <pre>
// state = {
//     query: {dataset query state - see dataset.queryState object}
//     view-{id1}: {view-state for this view}
//     view-{id2}: {view-state for }
//     ...
//     // Explorer
//     currentView: id of current view (defaults to first view if not specified)
//     readOnly: (default: false) run in read-only mode
// }
// </pre>
//
// Note that at present we do *not* serialize information about the actual set
// of views in use -- e.g. those specified by the views argument -- but instead 
// expect either that the default views are fine or that the client to have
// initialized the MultiView with the relevant views themselves.
my.MultiView = Backbone.View.extend({
  template: ' \
  <div class="recline-data-explorer"> \
    <div class="alert-messages"></div> \
    \
    <div class="header"> \
      <div class="navigation"> \
        <div class="btn-group" data-toggle="buttons-radio"> \
        {{#views}} \
        <a href="#{{id}}" data-view="{{id}}" class="btn">{{label}}</a> \
        {{/views}} \
        </div> \
      </div> \
      <div class="recline-results-info"> \
        Results found <span class="doc-count">{{docCount}}</span> \
      </div> \
      <div class="menu-right"> \
        <div class="btn-group" data-toggle="buttons-checkbox"> \
          <a href="#" class="btn active" data-action="filters">Filters</a> \
          <a href="#" class="btn active" data-action="fields">Fields</a> \
        </div> \
      </div> \
      <div class="query-editor-here" style="display:inline;"></div> \
      <div class="clearfix"></div> \
    </div> \
    <div class="data-view-sidebar"></div> \
    <div class="data-view-container"></div> \
  </div> \
  ',
  events: {
    'click .menu-right a': '_onMenuClick',
    'click .navigation a': '_onSwitchView'
  },

  initialize: function(options) {
    var self = this;
    this.el = $(this.el);
    this._setupState(options.state);
    // Hash of 'page' views (i.e. those for whole page) keyed by page name
    if (options.views) {
      this.pageViews = options.views;
    } else {
      this.pageViews = [{
        id: 'grid',
        label: 'Grid',
        view: new my.Grid({
          model: this.model,
          state: this.state.get('view-grid')
        }),
      }, {
        id: 'graph',
        label: 'Graph',
        view: new my.Graph({
          model: this.model,
          state: this.state.get('view-graph')
        }),
      }, {
        id: 'map',
        label: 'Map',
        view: new my.Map({
          model: this.model,
          state: this.state.get('view-map')
        }),
      }, {
        id: 'timeline',
        label: 'Timeline',
        view: new my.Timeline({
          model: this.model,
          state: this.state.get('view-timeline')
        }),
      }];
    }
    // these must be called after pageViews are created
    this.render();
    this._bindStateChanges();
    this._bindFlashNotifications();
    // now do updates based on state (need to come after render)
    if (this.state.get('readOnly')) {
      this.setReadOnly();
    }
    if (this.state.get('currentView')) {
      this.updateNav(this.state.get('currentView'));
    } else {
      this.updateNav(this.pageViews[0].id);
    }

    this.model.bind('query:start', function() {
        self.notify({loader: true, persist: true});
      });
    this.model.bind('query:done', function() {
        self.clearNotifications();
        self.el.find('.doc-count').text(self.model.docCount || 'Unknown');
      });
    this.model.bind('query:fail', function(error) {
        self.clearNotifications();
        var msg = '';
        if (typeof(error) == 'string') {
          msg = error;
        } else if (typeof(error) == 'object') {
          if (error.title) {
            msg = error.title + ': ';
          }
          if (error.message) {
            msg += error.message;
          }
        } else {
          msg = 'There was an error querying the backend';
        }
        self.notify({message: msg, category: 'error', persist: true});
      });

    // retrieve basic data like fields etc
    // note this.model and dataset returned are the same
    // TODO: set query state ...?
    this.model.queryState.set(self.state.get('query'), {silent: true});
    this.model.fetch()
      .fail(function(error) {
        self.notify({message: error.message, category: 'error', persist: true});
      });
  },

  setReadOnly: function() {
    this.el.addClass('recline-read-only');
  },

  render: function() {
    var tmplData = this.model.toTemplateJSON();
    tmplData.views = this.pageViews;
    var template = Mustache.render(this.template, tmplData);
    $(this.el).html(template);

    // now create and append other views
    var $dataViewContainer = this.el.find('.data-view-container');
    var $dataSidebar = this.el.find('.data-view-sidebar');

    // the main views
    _.each(this.pageViews, function(view, pageName) {
      $dataViewContainer.append(view.view.el);
      if (view.view.elSidebar) {
        $dataSidebar.append(view.view.elSidebar);
      }
    });

    var pager = new recline.View.Pager({
      model: this.model.queryState
    });
    this.el.find('.recline-results-info').after(pager.el);

    var queryEditor = new recline.View.QueryEditor({
      model: this.model.queryState
    });
    this.el.find('.query-editor-here').append(queryEditor.el);

    var filterEditor = new recline.View.FilterEditor({
      model: this.model
    });
    this.$filterEditor = filterEditor.el;
    $dataSidebar.append(filterEditor.el);

    var fieldsView = new recline.View.Fields({
      model: this.model
    });
    this.$fieldsView = fieldsView.el;
    $dataSidebar.append(fieldsView.el);
  },

  updateNav: function(pageName) {
    this.el.find('.navigation a').removeClass('active');
    var $el = this.el.find('.navigation a[data-view="' + pageName + '"]');
    $el.addClass('active');
    // show the specific page
    _.each(this.pageViews, function(view, idx) {
      if (view.id === pageName) {
        view.view.el.show();
        if (view.view.elSidebar) {
          view.view.elSidebar.show();
        }
        view.view.trigger('view:show');
      } else {
        view.view.el.hide();
        if (view.view.elSidebar) {
          view.view.elSidebar.hide();
        }
        view.view.trigger('view:hide');
      }
    });
  },

  _onMenuClick: function(e) {
    e.preventDefault();
    var action = $(e.target).attr('data-action');
    if (action === 'filters') {
      this.$filterEditor.toggle();
    } else if (action === 'fields') {
      this.$fieldsView.toggle();
    }
  },

  _onSwitchView: function(e) {
    e.preventDefault();
    var viewName = $(e.target).attr('data-view');
    this.updateNav(viewName);
    this.state.set({currentView: viewName});
  },

  // create a state object for this view and do the job of
  // 
  // a) initializing it from both data passed in and other sources (e.g. hash url)
  //
  // b) ensure the state object is updated in responese to changes in subviews, query etc.
  _setupState: function(initialState) {
    var self = this;
    // get data from the query string / hash url plus some defaults
    var qs = my.parseHashQueryString();
    var query = qs.reclineQuery;
    query = query ? JSON.parse(query) : self.model.queryState.toJSON();
    // backwards compatability (now named view-graph but was named graph)
    var graphState = qs['view-graph'] || qs.graph;
    graphState = graphState ? JSON.parse(graphState) : {};

    // now get default data + hash url plus initial state and initial our state object with it
    var stateData = _.extend({
        query: query,
        'view-graph': graphState,
        backend: this.model.backend.__type__,
        url: this.model.get('url'),
        currentView: null,
        readOnly: false
      },
      initialState);
    this.state = new recline.Model.ObjectState(stateData);
  },

  _bindStateChanges: function() {
    var self = this;
    // finally ensure we update our state object when state of sub-object changes so that state is always up to date
    this.model.queryState.bind('change', function() {
      self.state.set({query: self.model.queryState.toJSON()});
    });
    _.each(this.pageViews, function(pageView) {
      if (pageView.view.state && pageView.view.state.bind) {
        var update = {};
        update['view-' + pageView.id] = pageView.view.state.toJSON();
        self.state.set(update);
        pageView.view.state.bind('change', function() {
          var update = {};
          update['view-' + pageView.id] = pageView.view.state.toJSON();
          // had problems where change not being triggered for e.g. grid view so let's do it explicitly
          self.state.set(update, {silent: true});
          self.state.trigger('change');
        });
      }
    });
  },

  _bindFlashNotifications: function() {
    var self = this;
    _.each(this.pageViews, function(pageView) {
      pageView.view.bind('recline:flash', function(flash) {
        self.notify(flash); 
      });
    });
  },

  // ### notify
  //
  // Create a notification (a div.alert in div.alert-messsages) using provided
  // flash object. Flash attributes (all are optional):
  //
  // * message: message to show.
  // * category: warning (default), success, error
  // * persist: if true alert is persistent, o/w hidden after 3s (default = false)
  // * loader: if true show loading spinner
  notify: function(flash) {
    var tmplData = _.extend({
      message: 'Loading',
      category: 'warning',
      loader: false
      },
      flash
    );
    if (tmplData.loader) {
      var _template = ' \
        <div class="alert alert-info alert-loader"> \
          {{message}} \
          <span class="notification-loader">&nbsp;</span> \
        </div>';
    } else {
      var _template = ' \
        <div class="alert alert-{{category}} fade in" data-alert="alert"><a class="close" data-dismiss="alert" href="#">×</a> \
          {{message}} \
        </div>';
    }
    var _templated = $(Mustache.render(_template, tmplData));
    _templated = $(_templated).appendTo($('.recline-data-explorer .alert-messages'));
    if (!flash.persist) {
      setTimeout(function() {
        $(_templated).fadeOut(1000, function() {
          $(this).remove();
        });
      }, 1000);
    }
  },

  // ### clearNotifications
  //
  // Clear all existing notifications
  clearNotifications: function() {
    var $notifications = $('.recline-data-explorer .alert-messages .alert');
    $notifications.fadeOut(1500, function() {
      $(this).remove();
    });
  }
});

// ### MultiView.restore
//
// Restore a MultiView instance from a serialized state including the associated dataset
my.MultiView.restore = function(state) {
  var dataset = recline.Model.Dataset.restore(state);
  var explorer = new my.MultiView({
    model: dataset,
    state: state
  });
  return explorer;
}


// ## Miscellaneous Utilities
var urlPathRegex = /^([^?]+)(\?.*)?/;

// Parse the Hash section of a URL into path and query string
my.parseHashUrl = function(hashUrl) {
  var parsed = urlPathRegex.exec(hashUrl);
  if (parsed === null) {
    return {};
  } else {
    return {
      path: parsed[1],
      query: parsed[2] || ''
    };
  }
};

// Parse a URL query string (?xyz=abc...) into a dictionary.
my.parseQueryString = function(q) {
  if (!q) {
    return {};
  }
  var urlParams = {},
    e, d = function (s) {
      return unescape(s.replace(/\+/g, " "));
    },
    r = /([^&=]+)=?([^&]*)/g;

  if (q && q.length && q[0] === '?') {
    q = q.slice(1);
  }
  while (e = r.exec(q)) {
    // TODO: have values be array as query string allow repetition of keys
    urlParams[d(e[1])] = d(e[2]);
  }
  return urlParams;
};

// Parse the query string out of the URL hash
my.parseHashQueryString = function() {
  q = my.parseHashUrl(window.location.hash).query;
  return my.parseQueryString(q);
};

// Compse a Query String
my.composeQueryString = function(queryParams) {
  var queryString = '?';
  var items = [];
  $.each(queryParams, function(key, value) {
    if (typeof(value) === 'object') {
      value = JSON.stringify(value);
    }
    items.push(key + '=' + encodeURIComponent(value));
  });
  queryString += items.join('&');
  return queryString;
};

my.getNewHashForQueryString = function(queryParams) {
  var queryPart = my.composeQueryString(queryParams);
  if (window.location.hash) {
    // slice(1) to remove # at start
    return window.location.hash.split('?')[0].slice(1) + queryPart;
  } else {
    return queryPart;
  }
};

my.setHashQueryString = function(queryParams) {
  window.location.hash = my.getNewHashForQueryString(queryParams);
};

})(jQuery, recline.View);

