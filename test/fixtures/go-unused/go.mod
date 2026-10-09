module example.com/depfixture-unused

go 1.21

require example.com/leftover v0.0.0

replace example.com/leftover => ./leftover
