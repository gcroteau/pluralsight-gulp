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

gulp.task('less-watchers', function() {
  gulp.watch([config.less], ['styles']);
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
gulp.task('inject', ['wiredep', 'styles'], function() {
  log('Inject the bower css js and our app js into the html');

  return gulp
    .src(config.index)
    .pipe($.inject(gulp.src(config.css)))
    .pipe(gulp.dest(config.client));
});

gulp.task('serve-dev', ['inject'], function() {
  var isDev = true;

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
      startBrowserSync();
    })
    .on('crash', function() {
      log('*** nodemon crashed: script crashed for some reason ***');
    })
    .on('exit', function() {
      log('*** nodemon exited cleanly ***');
    });
});

function changeEvent(event) {
  var srcPattern = new RegExp('/.*(?=/' + config.source + ')/'); // What file has changed
  log('File ' + event.path.replace(srcPattern, '') + ' ' + event.type);
}

function startBrowserSync() {
  if(args.nosync || browserSync.active) {
    return;
  }
  log('Starting browser-sync on port ' + port);

  gulp.watch([config.less], ['styles'])
    .on('change', function(event) { changeEvent(event); });

  var options = {
    proxy: 'localhost:' + port,
    port: 3000,
    files: [
      config.client + '**/*.*',
      '!' + config.less,
      config.temp + '**/*.css' // temp is where the compiled css are put
    ],
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
