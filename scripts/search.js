function addCategoryExpandAndCollapseEventListener() {
    $('.category > a').on('click', function() {
        // Find glyphicon element
        // then toggle expand glyphicon
        $(this).find('.glyphicon').toggleClass('glyphicon-triangle-bottom');
        // and toggle collapse glyphicon
        $(this).find('.glyphicon').toggleClass('glyphicon-triangle-right');

        // Toggle show/hide subcategories with jQuery UI's 'blind' animation
        $(this).siblings().last().toggle('blind');
    });
}

// Get list of words in text
function getWords(text) {
    return text.trim().match(/[a-z0-9']+/gi);
}

// Get text with only numbers and alphabets
function getCleanText(text) {
    return getWords(text).join(' ');
}

// Add additional attributes to data
function enhanceData(data) {
    for (var i in data) {
        data[i].cleanText = getCleanText(data[i].text);
        data[i].childSelector = data[i].selector.children().last();
        data[i].keywords = data[i].cleanText;
        if (data[i].related) {
            data[i].keywords += ' ' + getCleanText(data[i].related);
        }
    }
    return data;
}

function buildCategoryTree(data) {
    var tree = {};
    // Construct adjacency list from data
    data.forEach(function(entry) {
        // Initialize adjacency list if null
        tree[entry.text] = tree[entry.text] || [];
        tree[entry.parent] = tree[entry.parent] || [];

        tree[entry.parent].push(entry);
    });
    return tree;
}

function createSearchIndex(data) {
    // Create search index
    var index = lunr(function() {
        this.field('keywords');
        this.ref('text');
    });

    // Input data to search index
    data.forEach(function(entry) {
        index.add(entry);
    });
    return index;
}

// Expand and show specified selector
function expandAndShowSelf(selector) {
    selector.show();
    // Show its subcategories
    selector.children().last().show();
    if (selector.hasClass('category')) {
        // Find glyphicon inside child anchor element
        // then add expand glyphicon
        selector.find('> a .glyphicon').addClass('glyphicon-triangle-bottom');
        // and remove collapse glyphicon
        selector.find('> a .glyphicon').removeClass('glyphicon-triangle-right');
    }
}

// Expand and show all descendents of specified selector
function expandAndShowDescendants(selector) {
    selector.find('.category, .main-category').each(function() {
        expandAndShowSelf($(this));
    });

    selector.find('.keyword').each(function() {
        $(this).show();
    });
}

function hideNotInResults(keyword, results, categoryTree) {
    var selector = keyword.selector;
    var childSelector = keyword.childSelector;
    var isInResults = (results.indexOf(keyword.text) > -1);

    var isChildInResults = false;
    categoryTree[keyword.text].forEach(function(child) {
        isChildInResults |= hideNotInResults(child, results, categoryTree);
    });

    if (selector) {
        if (isInResults) {
            // If this keyword is in results, expand and show self and all descendants
            expandAndShowSelf(selector);
            expandAndShowDescendants(selector);
        } else {
            if (isChildInResults) {
                // If this keyword is not in results but its child is then show this
                selector.show();
                childSelector.show();
            } else {
                // Otherwise, hide the whole tree
                selector.hide();
                childSelector.hide();
            }
        }
    }

    return isInResults | isChildInResults;
}

function getBaseWord(index, text) {
    // Use lunr.js stemmer to get base word
    return index.pipeline.run(lunr.tokenizer([text]))[0];
}

function highlightInResults(keyword, tokens, index, categoryTree) {
    var selector = keyword.selector;

    if (keyword.text) {
        // Split text into tokens
        var wordTokens = getWords(keyword.text);
        wordTokens.forEach(function(token) {
            // Get base word of each token
            var baseToken = getBaseWord(index, token);

            // If base token is in results
            if (tokens.indexOf(baseToken) > -1) {
                // Use 'highlighted' class to highlight text
                selector.find('.label-text').highlight(token, { className: 'highlighted' });
            }
        });
    }

    // Also highlight its children
    categoryTree[keyword.text].forEach(function(child) {
        highlightInResults(child, tokens, index, categoryTree);
    });
}

// Return location of html fragment template file for specified element
function getTemplateUrl(elementName) {
    switch(elementName) {
        case 'mainCategory':
            return 'search-main-category-partial.html';
        case 'category':
            return 'search-category-partial.html';
        case 'keyword':
            return 'search-keyword-partial.html';
        default:
            return null;
    }
}

function getDirectiveCompiler(elementName, searchData) {
    return function() {
        return {
            restrict: 'E',
            scope: { // Bind with attribute value
                text: '@',
                type: '@',
                href: '@',
                label: '@',
                related: '@'
            },
            replace: true,
            // This option allows elements to be nested
            transclude: true,
            // This element will be replaced by html fragment template
            templateUrl: getTemplateUrl(elementName),
            link: function(scope, element) {
                // Add entry to search data
                searchData.push({
                    text: scope.text,
                    related: scope.related,
                    selector: element,
                    // Parent is empty string if this element doesn't have parent scope
                    parent: scope.$parent.$parent ? scope.$parent.$parent.text : '' 
                });
            }
        }
    };
}

function compileSearchDirectives(callback) {
    var searchData = [];
    var TIMEOUT = 1000;

    // List of custom elements
    var elementNames = ['mainCategory', 'category', 'keyword'];

    // Initialize a new angular module
    var searchDirectives = angular.module('searchDirectives', []);

    // Add directive compilers to search directives module
    elementNames.forEach(function(elementName) {
        searchDirectives.directive(elementName, getDirectiveCompiler(elementName, searchData));
    });

    searchDirectives.run(function($timeout) {
        // Wait until all directives compiled
        $timeout(function() {
            callback(searchData)
        }, TIMEOUT);
    });
}

function searchText(query, index, categoryTree) {
    // Expand children to reset search
    expandAndShowDescendants($(document));
    // Remove 'highlighted' class from the whole page
    $(document).unhighlight({ className: 'highlighted' });

    // Don't do search when query is empty
    if (query == '') {
        return;
    }
    // Do an OR search
    var queryTokens = getWords(query);
    var tokens = index.pipeline.run(lunr.tokenizer(query));

    // Combine search results for each token
    var results = [];
    queryTokens.forEach(function(token) {
        var result = index.search(token);
        result.forEach(function(entry) {
            results.push(entry.ref);
        });
    });

    var rootKeyword = {
        text: ''
    };

    // Hide keyword not in results
    hideNotInResults(rootKeyword, results, categoryTree);
    // Highlight keyword in results
    highlightInResults(rootKeyword, tokens, index, categoryTree);
}

function addSearchEventListener(index, categoryTree) {
    var timeoutReference;
    var TIMEOUT = 500;

    $('#search-box').keyup(function(e) {
        var query = $(this).val();

        // When an activity occurs, clear activity timeout
        if (timeoutReference) {
            clearTimeout(timeoutReference);
        }

        // If empty query or enter key or space key pressed
        if (query == '' || e.which == 13 || e.which == 32) { 
            searchText(query, index, categoryTree);

        } else { // If no activity in 500 ms, search current text anyway
            timeoutReference = setTimeout(function() {
                searchText(query, index, categoryTree);
            }, TIMEOUT);
        }
    });
}

compileSearchDirectives(function(searchData) { // Callback function

    // After compiling search directives complete, process data
    searchData = enhanceData(searchData);

    // Build search index
    var index = createSearchIndex(searchData);

    // Build tree structure
    var categoryTree = buildCategoryTree(searchData);

    // Add search event listener
    addSearchEventListener(index, categoryTree);

    // Add expand and collapse event listener
    addCategoryExpandAndCollapseEventListener();

    // Prevent default when linking to #
    $('.close-link').click(function(e) {
        e.preventDefault();
    });

    // Prepend horizontal line on every category list
    $('.category > .category-list').prepend('<div class="separator">');
});