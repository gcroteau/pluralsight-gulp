var config = require('./gulp.config')();
var args = require('yargs').argv;
var browserSync = require('browser-sync');
var gulp = require('gulp');
var del = require('del');
var path = require('path');
var _ = require('lodash');
var $ = require('gulp-load-plugins')({lazy: true});
var port = process.env.PORT || config.defaultPort;

gulp.task('help', $.taskListing);
gulp.task('default', ['help']);

gulp.task('vet', function() {
  log('Analyzing source with JSHint and JSCS');
  return gulp
    .src(config.alljs)
    .pipe($.if(args.verbose, $.print()))
    .pipe($.jscs())
    .pipe($.jshint())
    .pipe($.jshint.reporter('jshint-stylish', {verbose: true}))
    .pipe($.jshint.reporter('fail'));
});

gulp.task('styles', ['clean-styles'], function() {
  log('Compiling Less --> CSS');

  return gulp
    .src(config.less)
    .pipe($.plumber())
    .pipe($.less())
    .pipe($.autoprefixer({browsers: ['last 2 versions', '> 5%']}))
    .pipe(gulp.dest(config.temp));
});

gulp.task('fonts', ['clean-fonts'], function() {
  log('Copying fonts');

  return gulp
    .src(config.fonts)
    .pipe(gulp.dest(config.build + 'fonts'));
});

gulp.task('images', ['clean-images'], function() {
  log('Copying and compressing images');
  return gulp
    .src(config.images)
    .pipe($.imagemin( {optimizationLevel: 4} ))
    // Do not work with .gif:
    // https://github.com/sindresorhus/gulp-imagemin/issues/125
    .pipe(gulp.dest(config.build + 'images'));
});

gulp.task('clean', function(done) {
  var deleteConfig = [].concat(config.build, config.temp);
  log('Cleaning: ' + $.util.colors.blue(deleteConfig));
  del(deleteConfig, done);
});

gulp.task('clean-fonts', function(done) {
  clean(config.build + 'fonts/**/*.*', done);
});

gulp.task('clean-images', function(done) {
  clean(config.build + 'images/**/*.*', done);
});

gulp.task('clean-styles', function(done) {
  clean(config.temp + '**/*.css', done);
});

gulp.task('clean-code', function(done) {
  var files = [].concat(
    config.temp + '**/*.js',
    config.build + '**/*.html',
    config.build + 'js/**/*.js'
  );
  clean(files, done);
});

gulp.task('less-watchers', function() {
  gulp.watch([config.less], ['styles']);
});

gulp.task('templatecache', ['clean-code'], function() {
  log('Creating AngularJS $templateCache');

  return gulp
    .src(config.htmltemplates)
    .pipe($.minifyHtml({empty: true}))
    .pipe($.angularTemplatecache(
      config.templateCache.file,
      config.templateCache.options))
    .pipe(gulp.dest(config.temp));
});

gulp.task('wiredep', function() {
  log('Wire up the bower css js and our app js into the html');
  var options = config.getWiredepDefaultOptions();
  var wiredep = require('wiredep').stream;

  return gulp
    .src(config.index)
    .pipe(wiredep(options))
    .pipe($.inject(gulp.src(config.js)))
    .pipe(gulp.dest(config.client));
});

// Does "everything": All css (even the custom that is compiled), all js
gulp.task('inject', ['wiredep', 'styles', 'templatecache'], function() {
  log('Inject the bower css js and our app js into the html');

  return gulp
    .src(config.index)
    .pipe($.inject(gulp.src(config.css)))
    .pipe(gulp.dest(config.client));
});

gulp.task('build', ['optimize', 'fonts', 'images'], function() {
  log('Build everything');

  var msg = {
    title: 'gulp build',
    subtitle: 'Deplyoed to the build folder',
    message: 'Running gulp serve-build'
  };
  del(config.temp);
  log(msg);
  notify(msg);
});

gulp.task('serve-specs', ['build-specs'], function(done) {
  log('Running the specs runner');
  serve(true, true);
  done();
});

gulp.task('build-specs', ['templatecache'], function() {
  log('Building the specs runner');

  var wiredep = require('wiredep').stream;
  var options = config.getWiredepDefaultOptions();
  var specs = config.specs;
  options.devDependencies = true;
  // Because testing is a specical case, you might need the devDependencies
  // to be referenced in the specs.html

  if(args.startServers) {
    specs = [].concat(specs, config.serverIntegrationSpecs);
  }

  return gulp
    .src(config.specRunner)
    .pipe(wiredep(options))
    .pipe($.inject(gulp.src(config.testLibraries),
      { name: 'inject:testlibraries', read: false }))
    .pipe($.inject(gulp.src(config.js)))
    .pipe($.inject(gulp.src(config.specHelpers),
      { name: 'inject:spechelpers', read: false }))
    .pipe($.inject(gulp.src(specs),
      { name: 'inject:specs', read: false }))
    .pipe($.inject(gulp.src(config.temp + config.templateCache.file),
      { name: 'inject:templates', read: false }))
    .pipe(gulp.dest(config.client));
});

gulp.task('optimize', ['inject', 'test'], function() {
  log('Optimizing js, html, css');

  var assets = $.useref.assets({searchPath: './'});
  var cssFilter = $.filter(['**/*.css']);
  var templateCache =  config.temp + config.templateCache.file;
  var jsLibFilter = $.filter('**/' + config.optimized.lib);
  var jsAppFilter = $.filter('**/' + config.optimized.app);

  return gulp
    .src(config.index)
    .pipe($.plumber())
    .pipe($.inject(gulp.src(templateCache, {read: false}), {
      starttag: '<!-- inject:templates:js -->'
    }))
    .pipe(assets) // concat all the files between the comments tag in the index.html file into one file
    .pipe(cssFilter)
    .pipe($.csso())
    .pipe(cssFilter.restore())
    .pipe(jsLibFilter)
    .pipe($.uglify())
    .pipe(jsLibFilter.restore())
    .pipe(jsAppFilter)
    .pipe($.ngAnnotate()) // If you forget to put $inject in your code, this will do it for you
    .pipe($.uglify())
    .pipe(jsAppFilter.restore())
    .pipe($.rev()) // Versioning for Cache Bumbping -> app.js -> app-1.23413412jr.js
    .pipe(assets.restore())
    .pipe($.useref()) // File concatenation
    .pipe($.revReplace())
    .pipe(gulp.dest(config.build))
    .pipe($.rev.manifest())
    .pipe(gulp.dest(config.build));
});

/**
* Bump the Version
* --type=pre will bump the prerelease version *.*.*-x
* --type=patch will bump the patch version *.*.x
* --type=minor will bump the minor version *.x.*
* --type=major will bump the major version x.*.*
* --version=1.2.3 will bump will bump to a specific version and ignore other flags
*/
gulp.task('bump', function() { // So that you can manage the version of your website / web app
  var msg = 'Bumping versions';
  var type = args.type;
  var version = args.version;
  var options = {};

  if(version) {
    options.version = version;
    msg += ' to ' + version;
  } else {
    options.type = type;
    msg += ' for a ' + type;
  }
  log(msg);

  return gulp
    .src(config.packages)
    .pipe($.print())
    .pipe($.bump(options))
    .pipe(gulp.dest(config.root));
});

gulp.task('serve-build', ['build'], function() {
  serve(false);
});

gulp.task('serve-dev', ['inject'], function() {
  serve(true);
});

gulp.task('test', ['vet', 'templatecache'], function(done) {
  startTests(true, done);
});

gulp.task('autotest', ['vet', 'templatecache'], function(done) {
  startTests(false, done);
});

///////////////////

function serve(isDev, specRunner) {
  var nodeOptions = {
      script: config.nodeServer,
      delayTime: 1,
      env: { // Found in src/server/app.js
        'PORT': port,
        'NODE_ENV': isDev ? 'dev' : 'build'
      },
      watch: [config.server]
  };

  return $.nodemon(nodeOptions)
    .on('restart', ['vet'], function(ev) {
      log('*** nodemon restarted ***');
      log('files changed on restart:\n' + ev);
      setTimeout(function() {
        browserSync.notify('reloading now...');
        browserSync.reload({ stream: false });
      }, config.browerReloadDelay);
    })
    .on('start', function(ev) {
      log('*** nodemon started ***');
      startBrowserSync(isDev, specRunner);
    })
    .on('crash', function() {
      log('*** nodemon crashed: script crashed for some reason ***');
    })
    .on('exit', function() {
      log('*** nodemon exited cleanly ***');
    });
}

function changeEvent(event) {
  var srcPattern = new RegExp('/.*(?=/' + config.source + ')/'); // What file has changed
  log('File ' + event.path.replace(srcPattern, '') + ' ' + event.type);
}

function notify(options) {
  var notifier = require('node-notifier');
  var notifyOptions = {
    sound: 'Bottle',
    contentImage: path.join(__dirname, 'gulp.png'),
    icon: path.join(__dirname, 'gulp.png')
  };
  _.assign(notifyOptions, options);
  notifier.notify(notifyOptions);
}

function startBrowserSync(isDev, specRunner) {
  if(args.nosync || browserSync.active) {
    return;
  }
  log('Starting browser-sync on port ' + port);

  if(isDev) {
    gulp.watch([config.less], ['styles'])
      .on('change', function(event) { changeEvent(event); });
  } else {
    gulp.watch([config.less, config.js, config.html], ['optimize', browserSync.reload])
      .on('change', function(event) { changeEvent(event); });
  }

  var options = {
    proxy: 'localhost:' + port,
    port: 3000,
    files: isDev ? [
      config.client + '**/*.*',
      '!' + config.less,
      config.temp + '**/*.css' // temp is where the compiled css are put
    ] : [],
    ghostMode: {
      clicks: true,
      location: false,
      forms: true,
      scroll: true
    },
    injectChanges: true, // Inject just the changed files if it can
    logFileChanges: true,
    logLevel: 'debug',
    logPrefix: 'gulp-patterns',
    notify: true,
    reloadDelay: 0
  };

  if(specRunner) {
    options.startPath = config.specRunnerFile;
  }
  browserSync(options);
}

function startTests(singleRun, done) {
  var child;
  var fork = require('child_process').fork;

  var karma = require('karma').server;
  var excludeFiles = [];
  var serverSpecs = config.serverIntegrationSpecs;

  if (args.startServers) {
    log('Starting server');
    var savedEnv = process.env;
    savedEnv.NODE_ENV = 'dev';
    savedEnv.PORT = 8888;
    child = fork(config.nodeServer);
  } else {
    if(serverSpecs && serverSpecs.length) {
      excludeFiles = serverSpecs;
    }
  }

  karma.start({
    configFile: __dirname + '/karma.conf.js',
    exclude: excludeFiles,
    singleRun: !!singleRun
  }, karmaCompleted);

  function karmaCompleted(karmaResult) {
    log('Karma completed!');
    if(child) {
      log('Shutting down the child process');
      child.kill();
    }
    if(karmaResult === 1) {
      done('karma: tests failed with code: ' + karmaResult);
    } else {
      done();
    }
  }
}


function clean(path, done) {
  log('Cleaning: ' + $.util.colors.blue(path));
  del(path).then(function(paths) {
    done();
  });
}

function log(msg) {
  if(typeof(msg) === 'object') {
    for(var item in msg) {
      if(msg.hasOwnProperty(item)) {
        $.util.log($.util.colors.blue(msg[item]));
      }
    }
  } else {
    $.util.log($.util.colors.blue(msg));
  }
}
