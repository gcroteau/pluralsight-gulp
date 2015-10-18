var config = require('./gulp.config')();
var args = require('yargs').argv;
var browserSync = require('browser-sync');
var gulp = require('gulp');
var del = require('del');
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
    .pipe($.imagemin( {optimizationLevel: 4} )) // Do not work with .gif: https://github.com/sindresorhus/gulp-imagemin/issues/125
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

gulp.task('optimize', ['inject', 'fonts', 'images'], function() {
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
  var msg = "Bumping versions";
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

gulp.task('serve-build', ['optimize'], function() {
  serve(false);
});

gulp.task('serve-dev', ['inject'], function() {
  serve(true);
});

///////////////////

function serve(isDev) {
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
      startBrowserSync(isDev);
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

function startBrowserSync(isDev) {
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
  browserSync(options);
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
